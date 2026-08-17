// dsh-cost-balance-pro — Client half (web)
// 输入框下方可见文字统计条（余额 · 花费）+ 点击展开明细面板 + 设置页。
window.__ModuleLoader__.load({
  id: 'dsh-cost-balance-pro',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const CSS =
      '.cbpPill{position:relative;display:flex;flex-direction:column;align-items:center;padding:2px 0 4px}' +
      '.cbpPill_bar{height:auto;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 12%,transparent);cursor:pointer;border:1px solid var(--dsw-alias-border-l1);padding:3px 12px;display:inline-flex;align-items:center;gap:6px;transition:opacity .15s ease;font-variant-numeric:tabular-nums}' +
      '.cbpPill_bar:hover{opacity:.75}' +
      '.cbpPill_panel{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);z-index:50;box-sizing:border-box;min-width:280px;max-width:min(420px,calc(100vw - 48px));background:color-mix(in srgb,var(--dsw-specific-menu) 80%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:var(--dsw-shadow-lv3);padding:10px 14px;font-size:12px;line-height:22px}' +
      '.cbpPill_row{justify-content:space-between;align-items:center;gap:12px;display:flex}' +
      '.cbpPill_label{color:var(--dsw-alias-label-tertiary);flex:none}' +
      '.cbpPill_value{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:500;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.cbpPill_hint{color:var(--dsw-alias-label-caption);text-align:center;margin-top:4px}' +
      '.cbpForm{display:flex;flex-direction:column;gap:14px;max-width:460px;padding:8px 0}' +
      '.cbpForm_row{display:flex;align-items:center;justify-content:space-between;gap:16px}' +
      '.cbpForm_label{color:var(--dsw-alias-label-primary);font-size:13px}' +
      '.cbpForm input[type=number]{width:64px}' +
      '.cbpForm input[type=color]{width:40px;height:26px;padding:0;border:none;background:none}' +
      '.cbpForm select{padding:2px 6px}' +
      '.cbpForm_actions{display:flex;gap:10px;margin-top:4px}' +
      '.cbpForm button{cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-tsp-secondary);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 16px;font-size:13px}' +
      '.cbpForm button:hover{opacity:.85}' +
      '.cbpForm_status{font-size:12px;color:var(--dsw-alias-label-secondary);min-height:16px}'

    const CSS_TAG = 'dsh-cost-balance-pro/style'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-cost-balance-pro'
      tag.dataset.pluginCss = CSS_TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    const DEFAULT_CONFIG = {
      showBalance: true,
      showCost: true,
      showHitRate: true,
      showPeakTag: true,
      fontSize: 12,
      colorMode: 'auto',
      customColor: '#8b5cf6',
    }

    // ── 配置存储（模块级 pub/sub，Host 持久化在 $DSH_HOME/dsh-cost-balance-pro.json） ──
    let currentConfig = { ...DEFAULT_CONFIG }
    const listeners = new Set()
    function setConfig(next) {
      currentConfig = { ...DEFAULT_CONFIG, ...(next ?? {}) }
      listeners.forEach((fn) => fn())
    }
    async function loadConfig() {
      try {
        const res = await fetch('/api/dsh-cost-balance-pro/config', { cache: 'no-store' })
        if (res.ok) setConfig(await res.json())
      } catch {
        // 后端不可达时保持默认
      }
    }
    function useConfig() {
      return React.useSyncExternalStore(
        (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
        () => currentConfig,
      )
    }

    function barColor(cfg) {
      if (cfg.colorMode === 'custom') return cfg.customColor
      if (cfg.colorMode === 'mono') return '#9ca3af'
      return 'var(--dsw-alias-label-secondary)'
    }

    function currencySymbol(currency) {
      return currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : (currency || '') + ' '
    }
    function formatCost(cost) {
      return Number(cost).toFixed(4).replace(/\.?0+$/, '')
    }
    function formatTokens(n) {
      return Number(n) >= 1000 ? (Number(n) / 1000).toFixed(1) + 'k' : String(n)
    }
    function formatDuration(ms) {
      const s = Math.round(ms / 1000)
      return s >= 60 ? Math.floor(s / 60) + 'm' + (s % 60) + 's' : s + 's'
    }
    function cacheHitPercent(usage) {
      const total = (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0)
      if (total <= 0) return null
      return Math.round(((usage.cacheReadTokens || 0) / total) * 100)
    }

    async function fetchReadout(usage) {
      const q = new URLSearchParams({
        uncached: String(usage.uncachedInputTokens || 0),
        cacheRead: String(usage.cacheReadTokens || 0),
        cacheWrite: String(usage.cacheWriteTokens || 0),
        output: String(usage.outputTokens || 0),
      })
      const res = await fetch('/api/dsh-cost-balance-pro/readout?' + q.toString(), { headers: { accept: 'application/json' } })
      if (!res.ok) return null
      const data = await res.json()
      return data !== null && typeof data === 'object' ? data : null
    }

    function StatsPill(props) {
      const cfg = useConfig()
      const usage = props.useProjection('tokenUsage')
      const [open, setOpen] = React.useState(false)
      const [readout, setReadout] = React.useState(null)
      const usageKey = usage === void 0
        ? ''
        : [usage.uncachedInputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.outputTokens].join(',')
      const refresh = React.useCallback(() => {
        if (usage === void 0) return
        fetchReadout(usage).then(setReadout).catch(() => setReadout(null))
      }, [usageKey])
      React.useEffect(() => { refresh() }, [refresh])
      React.useEffect(() => props.ctx.interval(() => refresh(), 60000), [refresh])

      const bal = readout !== null && readout.balance !== null && typeof readout.balance === 'object' && readout.balance.available
        ? readout.balance
        : null
      const cost = readout !== null && typeof readout.cost === 'number' ? readout.cost : null
      const win = readout !== null && (readout.window === 'peak' || readout.window === 'offPeak') ? readout.window : null
      const parts = []
      if (cfg.showBalance) parts.push(bal !== null ? currencySymbol(bal.currency) + bal.balance : '余额 --')
      if (cfg.showCost) parts.push(cost !== null ? '本次 $' + formatCost(cost) : '本次 --')
      const barLabel = parts.length > 0 ? parts.join(' · ') : '会话统计'

      const rows = []
      if (win !== null) rows.push(['当前时段', win === 'peak' ? '高峰（北京 09-12/14-18）· 峰价' : '空闲（半价）'])
      if (cfg.showHitRate && usage !== void 0) {
        const hit = cacheHitPercent(usage)
        if (hit !== null) rows.push(['缓存命中', hit + '%'])
      }
      if (usage !== void 0 && ((usage.uncachedInputTokens || 0) > 0 || (usage.outputTokens || 0) > 0)) {
        rows.push(['Token', '输入 ' + formatTokens(usage.uncachedInputTokens) + ' · 输出 ' + formatTokens(usage.outputTokens)])
      }
      if (cost !== null) rows.push(['花费', '$' + formatCost(cost)])
      rows.push(['余额', bal !== null ? currencySymbol(bal.currency) + bal.balance : '--'])

      return React.createElement('div', { className: 'cbpPill' }, [
        open
          ? React.createElement('div', { className: 'cbpPill_panel', key: 'panel' },
            rows.length === 0
              ? React.createElement('div', { className: 'cbpPill_hint' }, '暂无数据')
              : rows.map((row, i) => React.createElement('div', { className: 'cbpPill_row', key: i }, [
                React.createElement('span', { className: 'cbpPill_label', key: 'l' }, row[0]),
                React.createElement('span', { className: 'cbpPill_value', key: 'v' }, row[1]),
              ])))
          : null,
        React.createElement('button', {
          key: 'bar',
          type: 'button',
          className: 'cbpPill_bar',
          style: { fontSize: cfg.fontSize + 'px', color: barColor(cfg) },
          'aria-label': open ? '收起会话统计' : '展开会话统计',
          'aria-expanded': open,
          onClick: () => setOpen(!open),
        },
          cfg.showPeakTag && win !== null
            ? React.createElement('span', {
                key: 'peak',
                style: { color: win === 'peak' ? '#f59e0b' : '#10b981', fontWeight: 600 },
                'aria-label': win === 'peak' ? '高峰时段' : '空闲时段',
              }, win === 'peak' ? '峰' : '谷')
            : null,
          React.createElement('span', { key: 'label' }, barLabel)),
      ])
    }

    function CostBalanceSettings() {
      const cfg = useConfig()
      const [draft, setDraft] = React.useState(null)
      const [status, setStatus] = React.useState('')
      const d = draft ?? cfg
      const update = (patch) => setDraft({ ...d, ...patch })
      React.useEffect(() => { setDraft(null); setStatus('') }, [cfg])

      const save = async () => {
        try {
          const res = await fetch('/api/dsh-cost-balance-pro/config', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(d),
          })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          setConfig(await res.json())
          setStatus('已保存')
          setTimeout(() => setStatus(''), 2500)
        } catch (e) {
          setStatus('保存失败：' + String(e && e.message || e))
        }
      }
      const reset = async () => {
        try {
          const res = await fetch('/api/dsh-cost-balance-pro/reset', { method: 'POST' })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          setConfig(await res.json())
          setStatus('已还原为默认')
          setTimeout(() => setStatus(''), 2500)
        } catch (e) {
          setStatus('还原失败：' + String(e && e.message || e))
        }
      }

      return React.createElement('div', { className: 'cbpForm' }, [
        React.createElement('div', { className: 'cbpForm_row', key: 'bal' }, [
          React.createElement('span', { className: 'cbpForm_label' }, '显示余额'),
          React.createElement('input', { type: 'checkbox', checked: !!d.showBalance, onChange: (e) => update({ showBalance: e.target.checked }) }),
        ]),
        React.createElement('div', { className: 'cbpForm_row', key: 'cost' }, [
          React.createElement('span', { className: 'cbpForm_label' }, '显示本次花费'),
          React.createElement('input', { type: 'checkbox', checked: !!d.showCost, onChange: (e) => update({ showCost: e.target.checked }) }),
        ]),
        React.createElement('div', { className: 'cbpForm_row', key: 'hit' }, [
          React.createElement('span', { className: 'cbpForm_label' }, '显示缓存命中率'),
          React.createElement('input', { type: 'checkbox', checked: !!d.showHitRate, onChange: (e) => update({ showHitRate: e.target.checked }) }),
        ]),
        React.createElement('div', { className: 'cbpForm_row', key: 'peak' }, [
          React.createElement('span', { className: 'cbpForm_label' }, '显示时段徽标（峰/谷）'),
          React.createElement('input', { type: 'checkbox', checked: !!d.showPeakTag, onChange: (e) => update({ showPeakTag: e.target.checked }) }),
        ]),
        React.createElement('div', { className: 'cbpForm_row', key: 'size' }, [
          React.createElement('span', { className: 'cbpForm_label' }, '字号（10–16px）'),
          React.createElement('input', { type: 'number', min: 10, max: 16, value: d.fontSize, onChange: (e) => update({ fontSize: Number(e.target.value) }) }),
        ]),
        React.createElement('div', { className: 'cbpForm_row', key: 'mode' }, [
          React.createElement('span', { className: 'cbpForm_label' }, '颜色'),
          React.createElement('select', { value: d.colorMode, onChange: (e) => update({ colorMode: e.target.value }) }, [
            React.createElement('option', { value: 'auto', key: 'auto' }, '跟随主题'),
            React.createElement('option', { value: 'mono', key: 'mono' }, '灰色'),
            React.createElement('option', { value: 'custom', key: 'custom' }, '自定义'),
          ]),
        ]),
        d.colorMode === 'custom'
          ? React.createElement('div', { className: 'cbpForm_row', key: 'color' }, [
            React.createElement('span', { className: 'cbpForm_label' }, '自定义颜色'),
            React.createElement('input', { type: 'color', value: d.customColor, onChange: (e) => update({ customColor: e.target.value }) }),
          ])
          : null,
        React.createElement('div', { className: 'cbpForm_actions', key: 'actions' }, [
          React.createElement('button', { key: 'save', type: 'button', onClick: save }, '保存'),
          React.createElement('button', { key: 'reset', type: 'button', onClick: reset }, '一键还原'),
        ]),
        React.createElement('div', { className: 'cbpForm_status', key: 'status' }, status),
      ])
    }

    function apply(ctx) {
      void loadConfig()
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('conversation.composer.dock', () => slots.register(
        { name: 'conversation.composer.dock', id: 'cost-balance-pro', order: 0, priority: 0 },
        (props) => React.createElement(StatsPill, { ...props, ctx }),
      ))
      slots.inject('settings.plugins.tab', () => slots.register(
        { name: 'settings.plugins.tab', id: 'cost-balance-pro', order: 10, label: () => '余额统计条' },
        CostBalanceSettings,
      ))
    }

    exports.apply = apply
    exports.inject = ['timer']
    return module.exports
  },
})
