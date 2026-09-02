// dsh-cost-balance-pro — Host half
// 会话花费计算 + DeepSeek 账户余额抓取 + 样式配置持久化。
//
// 与 dsh-cost-balance 相比的修复/增强：
//   1. 槽位注册 id 改为唯一 'cost-balance-pro'，不与官方统计栏冲突；
//   2. 组件经 props 取得 ctx（原版模块级裸 ctx 导致渲染期 ReferenceError）；
//   3. 折叠态显示可见文字标签；
//   4. 设置页（显示开关/字号/颜色）+ 一键还原，配置存 $DSH_HOME/dsh-cost-balance-pro.json。
//   5. 动态价格同步：启动及每 12h 抓取官方定价页，自动识别新模型与价格变化；
//   6. 峰谷规则按官方口径：高峰仅限周一至周五，周末全天谷价。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-cost-balance-pro'
export const inject = ['webServer']

// 内置官方定价（USD / 1M tokens）。作为动态同步失败时的兜底价。
// 来源：https://api-docs.deepseek.com/quick_start/pricing（2026-08-17 峰谷价生效）
const DEFAULT_PRICES = {
  'deepseek-v4-flash': {
    peak: { hit: 0.014, miss: 0.44, out: 1.32 },
    offPeak: { hit: 0.007, miss: 0.22, out: 0.66 },
  },
  'deepseek-v4-flash-vision-exp': {
    peak: { hit: 0.014, miss: 0.44, out: 1.32 },
    offPeak: { hit: 0.007, miss: 0.22, out: 0.66 },
  },
  'deepseek-v4-pro': {
    peak: { hit: 0.044, miss: 1.32, out: 3.96 },
    offPeak: { hit: 0.022, miss: 0.66, out: 1.98 },
  },
}

// 官方峰谷规则（UTC）：高峰 01:00-04:00 与 06:00-10:00，周一至周五（周末全天谷价）。
// 来源：https://api-docs.deepseek.com/quick_start/pricing 脚注 (1)
const DEFAULT_PEAK_RULE = { weekdayOnly: true, windows: [[1, 4], [6, 10]] }

// 动态同步参数
const PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing'
const PRICE_SYNC_INTERVAL_MS = 12 * 3600 * 1000
const PRICE_SYNC_TIMEOUT_MS = 15000

// 官方定价页模型列顺序（表格列顺序固定，据此对齐价格列）
const MODEL_IDS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']

/** 当前计费时段：'peak' | 'offPeak'（按 UTC 判断，周末全天谷价） */
function currentWindow(now = new Date(), rule = DEFAULT_PEAK_RULE) {
  if (rule.weekdayOnly) {
    const day = now.getUTCDay() // 0=周日 .. 6=周六
    if (day === 0 || day === 6) return 'offPeak'
  }
  const h = now.getUTCHours()
  const windows = rule.windows ?? DEFAULT_PEAK_RULE.windows
  return windows.some(([a, b]) => h >= a && h < b) ? 'peak' : 'offPeak'
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
  costCurrency: 'cny', // cny | usd
  balanceCurrency: 'cny', // cny | usd
  usdCnyRate: 6.82,
  fontSize: 12,
  colorMode: 'auto', // auto | mono | custom
  customColor: '#8b5cf6',
}

const BALANCE_URL = 'https://api.deepseek.com/user/balance'

function configPath() {
  const root = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(root, 'dsh-cost-balance-pro.json')
}

function pricesCachePath() {
  const root = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(root, 'dsh-cost-balance-pro-prices.json')
}

function sanitize(raw) {
  const c = { ...DEFAULT_CONFIG }
  if (raw && typeof raw === 'object') {
    if (typeof raw.showBalance === 'boolean') c.showBalance = raw.showBalance
    if (typeof raw.showCost === 'boolean') c.showCost = raw.showCost
    if (typeof raw.showHitRate === 'boolean') c.showHitRate = raw.showHitRate
    if (typeof raw.showPeakTag === 'boolean') c.showPeakTag = raw.showPeakTag
    if (raw.costCurrency === 'cny' || raw.costCurrency === 'usd') c.costCurrency = raw.costCurrency
    if (raw.balanceCurrency === 'cny' || raw.balanceCurrency === 'usd') c.balanceCurrency = raw.balanceCurrency
    if (Number.isFinite(raw.usdCnyRate)) c.usdCnyRate = Math.min(20, Math.max(1, Number(raw.usdCnyRate.toFixed(4))))
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

// ── 官方定价页解析（英文版，USD 计价）─────────────────────────────────────

/** 把 HTML 去标签/实体后归一化成可读文本 */
function htmlToText(html) {
  return String(html)
    .replace(/<script[^>]*>.*?<\/script>/gs, ' ')
    .replace(/<style[^>]*>.*?<\/style>/gs, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 解析官方英文定价页，返回 { models, peakRule }。
 * 页面结构（2026-08+）：三个计费 bucket 行，各带 OFF-PEAK / PEAK 两组美元价，
 * 列顺序 = 模型细节表的模型列顺序（flash / pro / vision-exp）。
 * 峰谷规则脚注："Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday".
 */
function parseOfficialPricing(html) {
  const text = htmlToText(html)
  const modelIds = MODEL_IDS.filter((id) => text.includes(id))
  if (modelIds.length === 0) return null

  const readBucket = (re) => {
    const m = re.exec(text)
    if (m === null) return null
    const nums = (s) => [...s.matchAll(/\$([0-9.]+)/g)].map((x) => Number(x[1]))
    const offPeak = nums(m[1])
    const peak = nums(m[2])
    if (offPeak.length === 0 || offPeak.length !== peak.length) return null
    return { offPeak, peak }
  }

  const hit = readBucket(/1M\s+INPUT\s+TOKENS\s*\(\s*CACHE\s+HIT\s*\)\s+OFF-PEAK\s+((?:\$[0-9.]+\s*)+)PEAK\s+((?:\$[0-9.]+\s*)+)/)
  const miss = readBucket(/1M\s+INPUT\s+TOKENS\s*\(\s*CACHE\s+MISS\s*\)\s+OFF-PEAK\s+((?:\$[0-9.]+\s*)+)PEAK\s+((?:\$[0-9.]+\s*)+)/)
  const out = readBucket(/1M\s+OUTPUT\s+TOKENS\s+OFF-PEAK\s+((?:\$[0-9.]+\s*)+)PEAK\s+((?:\$[0-9.]+\s*)+)/)
  if (hit === null || miss === null || out === null) return null

  const cols = Math.min(hit.offPeak.length, miss.offPeak.length, out.offPeak.length, modelIds.length)
  if (cols === 0) return null

  const models = {}
  for (let c = 0; c < cols; c++) {
    const id = modelIds[c]
    models[id] = {
      peak: { hit: hit.peak[c], miss: miss.peak[c], out: out.peak[c] },
      offPeak: { hit: hit.offPeak[c], miss: miss.offPeak[c], out: out.offPeak[c] },
    }
  }
  if (Object.keys(models).length === 0) return null

  const weekdayOnly = /Monday\s+through\s+Friday|weekday/i.test(text)
  const windows = [...text.matchAll(/(\d{2}):00\s*-\s*(\d{2}):00/g)]
    .map((m) => [Number(m[1]), Number(m[2])])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && s < e)

  return {
    models,
    peakRule: {
      weekdayOnly,
      windows: windows.length > 0 ? windows : DEFAULT_PEAK_RULE.windows,
    },
  }
}

/** 抓取并解析官方定价页；失败返回 null（调用方保持上次价格） */
async function fetchOfficialPricing(url, timeoutMs) {
  let res
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  let html
  try {
    html = await res.text()
  } catch {
    return null
  }
  const parsed = parseOfficialPricing(html)
  if (parsed === null) return null
  return { at: Date.now(), prices: parsed.models, peakRule: parsed.peakRule }
}

async function readPricesCache() {
  try {
    const raw = JSON.parse(await readFile(pricesCachePath(), 'utf8'))
    if (raw && typeof raw === 'object' && raw.prices && typeof raw.prices === 'object') {
      return {
        prices: raw.prices,
        peakRule: raw.peakRule && typeof raw.peakRule === 'object' ? raw.peakRule : DEFAULT_PEAK_RULE,
      }
    }
  } catch {
    // 缓存缺失/损坏时静默回退
  }
  return null
}

async function writePricesCache(data) {
  try {
    await mkdir(join(pricesCachePath(), '..'), { recursive: true })
    await writeFile(pricesCachePath(), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  } catch {
    // 写缓存失败不影响运行
  }
}

export function apply(ctx, config = {}) {
  const userPrices = config.prices ?? {}
  // 价格优先级：用户显式配置 > 官方同步 > 内置默认
  let prices = { ...DEFAULT_PRICES, ...userPrices }
  let peakRule = { ...DEFAULT_PEAK_RULE }
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

  const applyOfficial = (fresh) => {
    if (fresh === null || typeof fresh !== 'object' || typeof fresh.prices !== 'object') return
    prices = { ...DEFAULT_PRICES, ...fresh.prices, ...userPrices }
    if (fresh.peakRule && typeof fresh.peakRule === 'object') {
      peakRule = {
        weekdayOnly: fresh.peakRule.weekdayOnly !== false,
        windows: Array.isArray(fresh.peakRule.windows) && fresh.peakRule.windows.length > 0
          ? fresh.peakRule.windows
          : DEFAULT_PEAK_RULE.windows,
      }
    }
  }

  const syncPrices = async () => {
    try {
      const fresh = await fetchOfficialPricing(PRICING_URL, PRICE_SYNC_TIMEOUT_MS)
      if (fresh !== null) {
        applyOfficial(fresh)
        await writePricesCache({ at: fresh.at, prices: fresh.prices, peakRule: fresh.peakRule })
      }
    } catch {
      // 网络失败保持上次价格
    }
  }

  // 先读上次缓存（秒级可用），再后台刷新官方价
  void (async () => {
    const cache = await readPricesCache()
    if (cache !== null) applyOfficial(cache)
    await syncPrices()
  })()

  ctx.effect(() => {
    const timer = setInterval(syncPrices, PRICE_SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  })

  const saveConfig = async (raw) => {
    current = sanitize(raw)
    await mkdir(join(configPath(), '..'), { recursive: true })
    await writeFile(configPath(), JSON.stringify(current, null, 2) + '\n', { mode: 0o600 })
    return current
  }

  const computeCost = (usage) => {
    const model = ctx.get('agentDefaultModel')?.currentSelection()?.model || 'deepseek-v4-flash'
    const window = currentWindow(new Date(), peakRule)
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

export { DEFAULT_PRICES, parseOfficialPricing, htmlToText, currentWindow }
