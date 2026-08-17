// dsh-cost-balance-pro — Host half
// 会话花费计算 + DeepSeek 账户余额抓取 + 样式配置持久化。
//
// 与 dsh-cost-balance 相比的修复/增强：
//   1. 槽位注册 id 改为唯一 'cost-balance-pro'，不与官方统计栏冲突；
//   2. 组件经 props 取得 ctx（原版模块级裸 ctx 导致渲染期 ReferenceError）；
//   3. 折叠态显示可见文字标签；
//   4. 设置页（显示开关/字号/颜色）+ 一键还原，配置存 $DSH_HOME/dsh-cost-balance-pro.json。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-cost-balance-pro'
export const inject = ['webServer']

// 官方定价（USD / 1M tokens）。来源：https://api-docs.deepseek.com/quick_start/pricing
// 峰谷计费上线后可在 profile 的 cordis.patch.yml 里用 config.prices 覆盖。
// DeepSeek 峰谷计费（2026-08-17 00:00 北京时间生效，USD/1M tokens）。
// 高峰 = UTC 01:00-04:00 与 06:00-10:00（北京 09:00-12:00 / 14:00-18:00），谷价为峰价一半。
// 来源：https://api-docs.deepseek.com/quick_start/pricing
const DEFAULT_PRICES = {
  'deepseek-v4-flash': {
    peak: { hit: 0.014, miss: 0.44, out: 1.32 },
    offPeak: { hit: 0.007, miss: 0.22, out: 0.66 },
  },
  'deepseek-v4-pro': {
    peak: { hit: 0.044, miss: 1.32, out: 3.96 },
    offPeak: { hit: 0.022, miss: 0.66, out: 1.98 },
  },
}

const PEAK_HOURS = [
  [1, 4],
  [6, 10],
]

/** 当前计费时段：'peak' | 'offPeak'（按 UTC 判断，与时区无关） */
function currentWindow(now = new Date()) {
  const h = now.getUTCHours()
  return PEAK_HOURS.some(([a, b]) => h >= a && h < b) ? 'peak' : 'offPeak'
}

/** 峰时价格相对谷时的倍数 */
function windowMultiplier(window) {
  return window === 'peak' ? 2 : 1
}

export const DEFAULT_CONFIG = {
  showBalance: true,
  showCost: true,
  showHitRate: true,
  showPeakTag: true,
  fontSize: 12,
  colorMode: 'auto', // auto | mono | custom
  customColor: '#8b5cf6',
}

const BALANCE_URL = 'https://api.deepseek.com/user/balance'

function configPath() {
  const root = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(root, 'dsh-cost-balance-pro.json')
}

function sanitize(raw) {
  const c = { ...DEFAULT_CONFIG }
  if (raw && typeof raw === 'object') {
    if (typeof raw.showBalance === 'boolean') c.showBalance = raw.showBalance
    if (typeof raw.showCost === 'boolean') c.showCost = raw.showCost
    if (typeof raw.showHitRate === 'boolean') c.showHitRate = raw.showHitRate
    if (typeof raw.showPeakTag === 'boolean') c.showPeakTag = raw.showPeakTag
    if (Number.isFinite(raw.fontSize)) c.fontSize = Math.min(16, Math.max(10, Math.round(raw.fontSize)))
    if (raw.colorMode === 'auto' || raw.colorMode === 'mono' || raw.colorMode === 'custom') c.colorMode = raw.colorMode
    if (typeof raw.customColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.customColor)) c.customColor = raw.customColor
  }
  return c
}

function sendJson(res, code, value) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
  } catch {
    return null
  }
}

export function apply(ctx, config = {}) {
  const prices = { ...DEFAULT_PRICES, ...(config.prices ?? {}) }
  let balanceCache = null
  let failureAt = 0
  let current = { ...DEFAULT_CONFIG }

  // 启动时读取已保存配置（失败静默回退默认）
  void (async () => {
    try {
      current = sanitize(JSON.parse(await readFile(configPath(), 'utf8')))
    } catch {
      current = { ...DEFAULT_CONFIG }
    }
  })()

  const saveConfig = async (raw) => {
    current = sanitize(raw)
    await mkdir(join(configPath(), '..'), { recursive: true })
    await writeFile(configPath(), JSON.stringify(current, null, 2) + '\n', { mode: 0o600 })
    return current
  }

  const computeCost = (usage) => {
    const model = ctx.get('agentDefaultModel')?.currentSelection()?.model || 'deepseek-v4-flash'
    const window = currentWindow()
    const rates = prices[model] ?? prices['deepseek-v4-flash']
    const p = rates[window] ?? rates['offPeak']
    const perMillion = (n, price) => (Math.max(0, Number(n) || 0) / 1e6) * price
    const cost = perMillion(usage.uncached, p.miss)
      + perMillion(usage.cacheRead, p.hit)
      + perMillion(usage.cacheWrite, p.miss)
      + perMillion(usage.output, p.out)
    return { cost, model, window, multiplier: windowMultiplier(window) }
  }

  const fetchBalance = async (force = false) => {
    const now = Date.now()
    if (!force && balanceCache !== null && now - balanceCache.at < 60000) return balanceCache.data
    if (now - failureAt < 30000) return { available: false, reason: 'throttled' }
    try {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return { available: false, reason: 'no-credentials-service' }
      const hit = await credentials.resolve('DEEPSEEK_API_KEY')
      if (hit === undefined) return { available: false, reason: 'no-api-key' }
      const shell = ctx.get('shell')
      if (shell === undefined) return { available: false, reason: 'no-shell-service' }
      const result = await shell.run(shell.resolve({
        command: 'curl -sS --max-time 15 -H "Authorization: Bearer $DSH_CB_KEY" "' + BALANCE_URL + '"',
        env: { DSH_CB_KEY: hit.value },
        timeoutMs: 20000,
      }))
      if (result.exitCode !== 0) throw new Error('curl exit ' + result.exitCode)
      const parsed = JSON.parse(result.stdout.text)
      const info = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.balance_infos)
        ? parsed.balance_infos[0]
        : undefined
      if (info === undefined) throw new Error('unexpected balance response')
      const data = { available: true, balance: String(info.total_balance), currency: String(info.currency) }
      balanceCache = { at: now, data }
      return data
    } catch (error) {
      failureAt = Date.now()
      console.error('[dsh-cost-balance-pro] balance fetch failed', error)
      return { available: false, reason: 'error', message: String((error && error.message) || error) }
    }
  }

  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  ctx.effect(() => {
    const disposers = [
      webServer.register({
        kind: 'exact',
        path: '/api/dsh-cost-balance-pro/config',
        handler: async (req, res) => {
          if (req.method === 'GET') return sendJson(res, 200, current)
          if (req.method === 'PUT') {
            const raw = await readBody(req)
            const saved = await saveConfig(raw)
            return sendJson(res, 200, saved)
          }
          sendJson(res, 405, { error: 'method not allowed' })
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/api/dsh-cost-balance-pro/reset',
        handler: async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
          const saved = await saveConfig({})
          return sendJson(res, 200, saved)
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/api/dsh-cost-balance-pro/readout',
        handler: async (req, res) => {
          let usage = { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
          let force = false
          try {
            const url = new URL(req.url ?? '/', 'http://x')
            usage = {
              uncached: Number(url.searchParams.get('uncached') ?? 0),
              cacheRead: Number(url.searchParams.get('cacheRead') ?? 0),
              cacheWrite: Number(url.searchParams.get('cacheWrite') ?? 0),
              output: Number(url.searchParams.get('output') ?? 0),
            }
            force = url.searchParams.get('force') === '1'
          } catch {
            // 参数缺省按全零处理
          }
          const { cost, model, window, multiplier } = computeCost(usage)
          const balance = await fetchBalance(force)
          sendJson(res, 200, { cost, model, window, multiplier, balance })
        },
      }),
    ]
    return () => disposers.forEach((dispose) => dispose())
  })
}
