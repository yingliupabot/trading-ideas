# 点子挖掘机 · 操作手册

`catalog.json` 是所有点子的**唯一真相源**，`index.html` 只是它的渲染。
挖掘机的铁律只有一条：**动手前先查表**。

## 工作流：六步

### 1. 采集 — 看到点子先别动手
在 TradingView、论文、博客、Reddit、书里看到有意思的点子，
第一步不是写代码，是打开点子库页面（或直接搜 `catalog.json`），
按标题、来源 URL、alias 查一遍。

### 2. 去重 — 表里有的，跳过
- 搜到了 → **直接跳过**，不重复扒。如果新来源有增量信息，
  把它加进该条目的 `aliases`，不新增条目。
- 没搜到 → 新增一条 `backlog`，字段按 schema 填：
  `claim` 必须写清楚——这个点子到底在 claim 什么，
  一句话，含糊的 claim 等于没法证伪，优先杀掉这种。

去重键优先级：`id/slug` > `source_url` > `aliases`。
同一个点子的 N 个实现（比如 Supertrend 的 50 个版本）算**一个点子**，
不要每个版本开一条。

### 3. 评分 — backlog 里先扒哪个
`priority`: high / medium / low，凭三条打分：
1. **可证伪性**：claim 越具体分越高，“感觉能赚钱”直接 low。
2. **与已杀点子的距离**：跟 32 个已杀 sweep 点子同类的，先看死因，
   死因能绕开的才值得扒。
3. **实现成本**：数据源现成、半天能跑完回测的优先。

### 4. 认领 — 一次只扒一个
开工时把状态从 `backlog` 改成 `in_progress`。
**`in_progress` 同时只允许存在一个**——并行扒三个等于三个都扒不深。

### 5. 回测 — 按仓库 AGENT.md 的规矩
- 必须跑 baseline 对照（默认 buy-hold，同标的可比基准）。
- 报告必须并列：策略收益 vs baseline 收益、超额收益、样本区间、交易次数。
- 只报策略收益不报 baseline 的，视为未完成。

### 6. 裁决 — published 或 killed，没有中间态
- **published**：写成笔记，填 `note_url`，`verdict` 照实填
  （win/fail/inconclusive；资料型填 null）。
- **killed**：不写笔记也必须留记录——`verdict` + `notes` 写清死因。
  死因是资产：下次看到同类点子，查表就知道不用再扒。
  仓库的 meta-edge 一半在“没亏出去的钱”上，点子库就是它的账本。

## schema 速查

| 字段 | 说明 |
|---|---|
| `id` | slug，全库唯一，去重主键 |
| `title` | 中文标题 |
| `kind` | strategy 策略 / paper 论文 / data 数据 / industry 行业 / blog 博客 |
| `source` | tradingview / reddit / paper / blog / self（自研） |
| `source_name` | 展示名，如 TradingView / r/algotrading / 自研 |
| `source_url` | 来源链接，去重用；自研可为空 |
| `aliases` | 同一点子的其他名字/实现，数组 |
| `date_added` | 入库日期 |
| `status` | backlog 待扒 / in_progress 扒取中 / published 已发布 / killed 已杀 |
| `verdict` | win 跑赢 / fail 没跑赢 / inconclusive 难定论 / null 资料型无回测 |
| `claim` | 一句话 claim，必须具体到可证伪 |
| `baseline` | 对照基准，如 SPY buy-hold |
| `result` | 回测数字：sample / strategy / baseline / excess_pp / sharpe / baseline_sharpe / trades / max_dd |
| `priority` | high / medium / low（只对 backlog/in_progress 有意义） |
| `tags` | 标签数组 |
| `note_url` | 已发布笔记的相对链接，无则 null |
| `notes` | 备注 / 死因 |

## 改完怎么验证

```bash
python3 -c "import json; d=json.load(open('trading-ideas/ideas/catalog.json')); print(len(d['ideas']))"
```

然后本地开个静态服务器看 `trading-ideas/ideas/` 页面渲染是否正常，
再走正常上传流程（pull-check → yingliupabot 网页上传）。
