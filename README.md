# trading-ideas

交易想法、Pine Script 研读和读书笔记。附带一个 GitHub Pages 静态站当 UI：

👉 https://yingliupabot.github.io/trading-ideas/

## 目录

- `trading-ideas/` — 交易研读：Pine Script 源码 + HTML 分析、策略回测、论文、数据源、组合
- `读书笔记/` — 读书笔记（绘本连载）
- `世界地图/` — 世界历史时间轴（互动地图，JS 前端）
- `index.html` / `notes.html` — 静态站首页与读书笔记目录（GitHub Pages）

## 加一个词条

```bash
mkdir -p 词条/1637-郁金香狂热
$EDITOR 词条/1637-郁金香狂热/meta.json
npm run index          # 重新生成 世界地图/词条.js
npm run shot -- 世界地图/index.html   # 想看效果
```

`status` 标 `点亮` / `在读` / `想读`。不懂的先标「想读」，地球上会显示成虚线圈 —— 看得见自己还没走到哪儿，比只看得见走过的地方重要。

也可以在世界地图页面右下角点「✎ 词条」直接改状态，导出后粘回文件。

## 说明

纯学习记录，不构成投资建议。
