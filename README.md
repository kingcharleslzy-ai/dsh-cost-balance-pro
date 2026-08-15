# dsh-cost-balance-pro

DSH 插件：输入框下方**可见文字**的会话花费/余额统计条，带设置页与一键还原。

## 能力

- 折叠态直接显示 **余额（¥）· 本次花费（$）**，点击展开明细（缓存命中 / Token / 花费 / 余额）
- **设置页**（设置 → 插件 → 余额统计条）：显示开关（余额/花费/命中率）、字号（10–16px）、颜色（跟随主题/灰色/自定义取色器）、**一键还原**
- 配置持久化于 `$DSH_HOME/dsh-cost-balance-pro.json`，重启保留

## 相对 dsh-cost-balance 的修复

1. 槽位注册 id 改为唯一 `cost-balance-pro`，不再与官方统计栏冲突（原版同槽同 id 同 priority 会挂掉整个前端）；
2. `ctx` 经 props 传入组件（原版模块级裸 `ctx` 导致槽位条目渲染期 ReferenceError，药丸从未渲染成功）；
3. 折叠态从 5px 无字细线改为可见文字。

## 安装

```bash
dsh plugin --profile web add dsh-cost-balance-pro
```

装后重启服务一次（或下次登录），刷新页面即可看到统计条；样式去设置页调整。

## 模型定价

内置 DeepSeek V4 官方定价（USD/1M），可在 profile 的 `cordis.patch.yml` 按 id 覆盖整行 config 传入 `prices`。

## License

MIT
