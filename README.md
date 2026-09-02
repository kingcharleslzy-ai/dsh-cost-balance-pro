# dsh-cost-balance-pro

DSH 插件：输入框下方**可见文字**的会话花费/余额统计条，带设置页与一键还原。

## 能力

- 折叠态直接显示 **余额（¥）· 本次花费（$）**，点击展开明细（缓存命中 / Token / 花费 / 余额）
- **设置页**（设置 → 插件 → 余额统计条）：显示开关（余额/花费/命中率）、字号（10–16px）、颜色（跟随主题/灰色/自定义取色器）、**一键还原**
- 配置持久化于 `$DSH_HOME/dsh-cost-balance-pro.json`，重启保留，保存后统计条即时刷新

## 设置页字段

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `showBalance` | boolean | `true` | 折叠态显示余额 |
| `showCost` | boolean | `true` | 折叠态显示本次花费 |
| `showHitRate` | boolean | `true` | 展开面板显示缓存命中率 |
| `costCurrency` | enum | `cny` | 花费货币：`cny` 人民币 / `usd` 美元 |
| `balanceCurrency` | enum | `cny` | 余额货币：`cny` 人民币 / `usd` 美元 |
| `usdCnyRate` | number | `6.82` | USD→CNY 汇率（余额/花费换算用，官方峰谷价隐含值） |
| `fontSize` | number | `12` | 折叠态字号，限制 10–16 |
| `colorMode` | enum | `auto` | `auto` 跟随主题 / `mono` 灰色 / `custom` 自定义 |
| `customColor` | string | `#8b5cf6` | `colorMode=custom` 时的文字颜色（#RRGGBB） |

## 相对 dsh-cost-balance 的修复

1. 槽位注册 id 改为唯一 `cost-balance-pro`，不再与官方统计栏冲突（原版同槽同 id 同 priority 会挂掉整个前端）；
2. `ctx` 经 props 传入组件（原版模块级裸 `ctx` 导致槽位条目渲染期 ReferenceError，药丸从未渲染成功）；
3. 折叠态从 5px 无字细线改为可见文字；
4. 客户端工厂补上 `return module.exports`（缺失时加载器收到 undefined，插件静默失效）；
5. 客户端模块声明 `exports.inject = ['timer']`（`ctx.interval` 需要 timer 注入）。

## 安装

```bash
dsh plugin --profile web add dsh-cost-balance-pro
```

装后重启服务一次（或下次登录），刷新页面即可看到统计条；样式去设置页调整。

## 模型定价（峰谷计费，动态同步）

DeepSeek 自 2026-08-17 起执行峰谷计费，2026-08-23 起高峰**仅限周一至周五**：**高峰 = UTC 01:00-04:00 与 06:00-10:00（北京 09:00-12:00 / 14:00-18:00），谷价为峰价一半，周末全天谷价**。本插件按当前时段自动计价，折叠态显示 **峰/谷 徽标**（峰橙、谷绿），展开面板显示当前时段说明。

**价格自动同步**（v0.2.0+）：启动时及每 12 小时抓取官方英文定价页，自动识别新模型与价格变化（如 `deepseek-v4-flash-vision-exp`），无需升级插件即可跟随官方价。失败时回退到上次缓存，再回退到内置默认价。优先级：**用户显式配置 > 官方同步 > 内置默认价**。同步结果缓存于 `$DSH_HOME/dsh-cost-balance-pro-prices.json`。

内置默认价（USD/1M，动态同步失败时的兜底）：

| 模型 | 时段 | 缓存命中 | 未命中 | 输出 |
|---|---|---|---|---|
| V4-Flash | 峰 | 0.014 | 0.44 | 1.32 |
| V4-Flash | 谷 | 0.007 | 0.22 | 0.66 |
| V4-Flash-Vision | 峰 | 0.014 | 0.44 | 1.32 |
| V4-Flash-Vision | 谷 | 0.007 | 0.22 | 0.66 |
| V4-Pro | 峰 | 0.044 | 1.32 | 3.96 |
| V4-Pro | 谷 | 0.022 | 0.66 | 1.98 |

可在 profile 的 `cordis.patch.yml` 按 id 覆盖整行 config 传入 `prices`（结构 `{ 模型: { peak: {hit, miss, out}, offPeak: {...} } }`），用户配置始终优先于官方同步结果。

## 开发

```bash
npm test          # 客户端契约测试（node:test）
npm pack --dry-run
```

发布：push `v*` 标签触发 GitHub Actions，经 npm OIDC trusted publishing 自动发布（带 provenance）。

## License

MIT
