# AGENT.md — trading-ideas

在这个仓库里干活时必须遵守的约定。

## 回测规范
- 任何回测必须同时跑 baseline 对照（默认 buy-and-hold，同标的可比基准如 SPY）。
- 只报策略收益、不报 baseline 的回测结果视为未完成，不许交付。
- 回测报告里必须并列给出：策略收益 vs baseline 收益、超额收益、样本区间、交易次数。
