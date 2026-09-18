#!/usr/bin/env python3
"""Validation of 动量熊市 overlay variant (bear → top3 momentum sectors).

Leg 1: main sample 2016-02-01→2026-09-17 + 5bps one-way cost on actual turnover.
Leg 2: out-of-sample 1999-01→2016-01, 9 sector ETFs (Dec-1998 SPDR lineup), bear if >=5/9 negative 6m momentum.
Leg 3: main window, core SPY→QQQ; baseline QQQ buy-hold.
All: same baseline must be reported per AGENT.md. No uploads, no repo edits.
"""
import json
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import yfinance as yf

VAL_DIR = os.path.expanduser("~/workspace/trading-ideas/sweeps/overlay-validation")
DATA_DIR = os.path.join(VAL_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
SECTOR_DIR = os.path.expanduser("~/workspace/trading-ideas/sweeps/sector-momentum/data")
SPY_FULL = os.path.expanduser("~/workspace/trading-ideas/sweeps/putwrite/SPY_full.csv")

COST_BPS = 5  # leg1 only


def load_local(t):
    df = pd.read_csv(os.path.join(SECTOR_DIR, f"{t}_daily.csv"), parse_dates=["Date"])
    return df.set_index("Date")[t]


def dl(t, start, end, fname):
    """download (cached) adjusted close from yfinance."""
    p = os.path.join(DATA_DIR, fname)
    if os.path.exists(p):
        df = pd.read_csv(p, parse_dates=["Date"]).set_index("Date")
        return df["AdjClose"]
    d = yf.download(t, start=start, end=end, auto_adjust=True, progress=False)
    c = d["Close"]
    if isinstance(c, pd.DataFrame):
        c = c.iloc[:, 0]
    c = c.rename("AdjClose")
    out = c.to_frame(); out.index.name = "Date"
    out.to_csv(p, index=True)
    return c


def metrics(r, label):
    eq = (1 + r).cumprod()
    cumret = eq.iloc[-1] - 1
    yrs = (r.index[-1] - r.index[0]).days / 365.25
    cagr = eq.iloc[-1] ** (1 / yrs) - 1
    sharpe = r.mean() / r.std() * np.sqrt(252) if r.std() > 0 else 0.0
    dd = eq / eq.cummax() - 1
    maxdd = dd.min()
    calmar = cagr / abs(maxdd) if maxdd < 0 else np.nan
    return dict(label=label, n=len(r), cumret=float(cumret), cagr=float(cagr),
                sharpe=float(sharpe), maxdd=float(maxdd), calmar=float(calmar),
                start=str(r.index[0].date()), end=str(r.index[-1].date()))


def month_records(px, tickers, threshold):
    """Monthly decisions: 6m momentum, bear if >=threshold negatives, top3 list."""
    month_end = px.resample("M").last()
    month_ends = month_end.index
    records = []
    for i in range(6, len(month_ends)):
        d, d6 = month_ends[i], month_ends[i - 6]
        mom = month_end.loc[d, tickers] / month_end.loc[d6, tickers] - 1
        valid = mom.dropna()
        n_neg = int((valid < 0).sum())
        bear = n_neg >= threshold
        ranked = valid.sort_values(ascending=False)
        records.append(dict(date=d, n_valid=len(valid), n_neg=n_neg,
                            bear=bool(bear), top3=list(ranked.head(3).index)))
    return pd.DataFrame(records).set_index("date")


def build_variant(rec, px, daily_ret, core, tickers, cost_bps=0):
    """Variant: bear -> equal top3; else 100% core. Cost on turnover, first day of month."""
    def w_of(row):
        return {t: 1 / 3 for t in row["top3"]} if row["bear"] else {core: 1.0}

    port_ret = pd.Series(index=px.index, dtype=float)
    reg = pd.Series(index=px.index, dtype=float)
    prev_raw = None
    prev_key = None
    total_turnover = 0.0
    n_switch = 0
    cost_days = 0
    for k, (d, row) in enumerate(rec.iterrows()):
        d_next = rec.index[k + 1] if k + 1 < len(rec) else px.index[-1]
        days = px.index[(px.index > d) & (px.index <= d_next)]
        if len(days) == 0:
            continue
        w = w_of(row)
        key = tuple(sorted((kk, round(v, 6)) for kk, v in w.items()))
        turnover = 0.0
        if prev_raw is not None:
            allk = set(prev_raw) | set(w)
            turnover = sum(max(w.get(kk, 0) - prev_raw.get(kk, 0), 0) for kk in allk)
            if key != prev_key:
                n_switch += 1
        prev_raw = dict(w); prev_key = key
        r = (daily_ret.loc[days, list(w.keys())] * pd.Series(w)).sum(axis=1)
        if turnover > 1e-9 and cost_bps > 0:
            total_turnover += turnover
            cost = (cost_bps / 10000) * turnover
            r.iloc[0] -= cost
            cost_days += 1
        port_ret.loc[days] = r
        reg.loc[days] = 1.0 if row["bear"] else 0.0
    return port_ret.dropna(), reg.loc[port_ret.dropna().index], total_turnover, cost_days, n_switch


def regime_stats(rec, core_px, label):
    dec = rec["bear"].astype(int)
    switches = int((dec.diff().abs() == 1).sum())
    bear_months = rec[rec["bear"]]
    me = core_px.resample("M").last().pct_change()
    false = total = 0
    for d in bear_months.index:
        loc = rec.index.get_loc(d)
        if loc + 1 >= len(rec):
            continue
        mret = me.loc[rec.index[loc + 1]]
        if pd.notna(mret):
            total += 1
            if mret > 0:
                false += 1
    return dict(label=label, regime_切换次数=switches, 熊市月份数=len(bear_months),
                误伤月份=false, 误伤分母=total,
                误伤率=(false / total if total else None))


def plot_leg(idx, eq_strat, eq_base, lab_s, lab_b, title, fname, maxdd_s, maxdd_b):
    fig, axes = plt.subplots(2, 1, figsize=(12, 8), sharex=True)
    axes[0].plot(eq_strat.index, eq_strat, label=lab_s)
    axes[0].plot(eq_base.index, eq_base, label=lab_b, alpha=0.7)
    axes[0].set_yscale("log"); axes[0].legend(); axes[0].set_title(title)
    axes[0].grid(True, alpha=0.3)
    dd_s = eq_strat / eq_strat.cummax() - 1
    dd_b = eq_base / eq_base.cummax() - 1
    axes[1].fill_between(dd_s.index, dd_s * 100, 0, alpha=0.5, label=f"{lab_s} DD (max {maxdd_s*100:.1f}%)")
    axes[1].plot(dd_b.index, dd_b * 100, color="gray", alpha=0.6,
                 label=f"{lab_b} DD (max {maxdd_b*100:.1f}%)")
    axes[1].legend(); axes[1].set_ylabel("drawdown %"); axes[1].grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(VAL_DIR, fname), dpi=100)
    plt.close(fig)


results_rows = []
reg_stats = {}

# ============ LEG 1: costs on main sample ============
print("=== LEG 1: 加成本 (5bps 单边) ===")
T11 = ["XLC", "XLY", "XLP", "XLE", "XLF", "XLV", "XLI", "XLB", "XLRE", "XLK", "XLU"]
L1_START, L1_END = "2016-02-01", "2026-09-17"
spy = pd.read_csv(SPY_FULL, parse_dates=["Date"]).set_index("Date").sort_index()
sectors = {t: load_local(t) for t in T11}
px1 = pd.DataFrame(sectors).join(spy["Close"].rename("SPY"), how="outer").sort_index()
px1 = px1.loc["2015-06-01":L1_END]
dr1 = px1.pct_change()
rec1 = month_records(px1, T11, threshold=6)
ret1, reg1, to1, cdays1, sw1 = build_variant(rec1, px1, dr1, "SPY", T11, cost_bps=COST_BPS)
ret1 = ret1.loc[L1_START:L1_END].dropna(); reg1 = reg1.loc[ret1.index]
base1 = dr1["SPY"].loc[ret1.index]
m1 = metrics(ret1, "leg1 变体+成本")
b1 = metrics(base1, "leg1 SPY baseline")
# no-cost rerun for drag measurement
ret1_nc, _, to1_nc, _, _ = build_variant(rec1, px1, dr1, "SPY", T11, cost_bps=0)
ret1_nc = ret1_nc.loc[L1_START:L1_END].dropna()
m1_nc = metrics(ret1_nc, "leg1 变体(无成本对照)")
drag_pp = (m1_nc["cumret"] - m1["cumret"]) * 100
print(f"turnover={to1:.2f}x NAV, cost_days={cdays1}, switches={sw1}")
print(f"无成本: cumret={m1_nc['cumret']*100:.2f}% sharpe={m1_nc['sharpe']:.3f}")
print(f"加成本: cumret={m1['cumret']*100:.2f}% sharpe={m1['sharpe']:.3f} | 成本拖累={drag_pp:.2f}pp, 年化约{drag_pp/10.63:.3f}pp/年")
print(f"baseline: cumret={b1['cumret']*100:.2f}% sharpe={b1['sharpe']:.3f} | 超额={(m1['cumret']-b1['cumret'])*100:.2f}pp, 超额Sharpe={m1['sharpe']-b1['sharpe']:.3f}")
results_rows.append(dict(leg="leg1_加成本", **m1,
                         超额累计pp=(m1["cumret"]-b1["cumret"])*100,
                         超额Sharpe=m1["sharpe"]-b1["sharpe"],
                         baseline累计=f"{b1['cumret']*100:.2f}%", baseline_Sharpe=round(b1["sharpe"],3),
                         交易次数=sw1, 总换手x=round(to1,2), 成本拖累pp=round(drag_pp,2)))
reg_stats["leg1"] = regime_stats(rec1, px1["SPY"], "leg1")
plot_leg(1, (1+ret1).cumprod(), (1+base1).cumprod(),
         f"variant+cost (+{m1['cumret']*100:.1f}%)", f"SPY (+{b1['cumret']*100:.1f}%)",
         "Leg1: variant + 5bps cost vs SPY (2016-02→2026-09)", "equity_leg1_cost.png",
         m1["maxdd"], b1["maxdd"])

# ============ LEG 2: out-of-sample 1999→2016 ============
print("\n=== LEG 2: 样本外 1999-01→2016-01 ===")
T9 = ["XLY", "XLP", "XLE", "XLF", "XLV", "XLI", "XLB", "XLK", "XLU"]
L2_END = "2016-01-31"
s9 = {t: dl(t, "1998-12-01", "2016-02-15", f"{t}_oos.csv") for t in T9}
spy_oos = dl("SPY", "1998-12-01", "2016-02-15", "SPY_oos.csv")
px2 = pd.DataFrame(s9).join(spy_oos.rename("SPY"), how="outer").sort_index()
px2 = px2.loc["1998-12-01":L2_END]
print("数据起止:", {t: (str(s9[t].index[0].date()), str(s9[t].index[-1].date())) for t in T9})
dr2 = px2.pct_change()
rec2 = month_records(px2, T9, threshold=5)
L2_START = str((rec2.index[0] + pd.offsets.MonthBegin(1)).date())
ret2, reg2, to2, cdays2, sw2 = build_variant(rec2, px2, dr2, "SPY", T9, cost_bps=0)
base2 = dr2["SPY"].loc[ret2.index]
m2 = metrics(ret2, "leg2 变体(样本外)")
b2 = metrics(base2, "leg2 SPY baseline")
print(f"实际样本: {m2['start']} → {m2['end']}; switches={sw2}")
print(f"变体: cumret={m2['cumret']*100:.2f}% cagr={m2['cagr']*100:.2f}% sharpe={m2['sharpe']:.3f} maxdd={m2['maxdd']*100:.2f}%")
print(f"baseline: cumret={b2['cumret']*100:.2f}% cagr={b2['cagr']*100:.2f}% sharpe={b2['sharpe']:.3f} maxdd={b2['maxdd']*100:.2f}%")
print(f"超额={(m2['cumret']-b2['cumret'])*100:.2f}pp, 超额Sharpe={m2['sharpe']-b2['sharpe']:.3f}")
results_rows.append(dict(leg="leg2_样本外", **m2,
                         超额累计pp=(m2["cumret"]-b2["cumret"])*100,
                         超额Sharpe=m2["sharpe"]-b2["sharpe"],
                         baseline累计=f"{b2['cumret']*100:.2f}%", baseline_Sharpe=round(b2["sharpe"],3),
                         交易次数=sw2, 总换手x=round(to2,2), 成本拖累pp=0))
reg_stats["leg2"] = regime_stats(rec2, px2["SPY"], "leg2")
plot_leg(2, (1+ret2).cumprod(), (1+base2).cumprod(),
         f"variant OOS (+{m2['cumret']*100:.1f}%)", f"SPY (+{b2['cumret']*100:.1f}%)",
         "Leg2: variant out-of-sample vs SPY (1999→2016)", "equity_leg2_oos.png",
         m2["maxdd"], b2["maxdd"])

# ============ LEG 3: QQQ core ============
print("\n=== LEG 3: 核心换 QQQ ===")
qqq = dl("QQQ", "2015-06-01", "2026-09-17", "QQQ_main.csv")
px3 = px1.copy()
px3["QQQ"] = qqq.reindex(px3.index)
dr3 = px3.pct_change()
ret3, reg3, to3, cdays3, sw3 = build_variant(rec1, px3, dr3, "QQQ", T11, cost_bps=0)
ret3 = ret3.loc[L1_START:L1_END].dropna()
base3 = dr3["QQQ"].loc[ret3.index]
m3 = metrics(ret3, "leg3 变体(QQQ核心)")
b3 = metrics(base3, "leg3 QQQ baseline")
print(f"变体: cumret={m3['cumret']*100:.2f}% cagr={m3['cagr']*100:.2f}% sharpe={m3['sharpe']:.3f} maxdd={m3['maxdd']*100:.2f}%")
print(f"baseline: cumret={b3['cumret']*100:.2f}% cagr={b3['cagr']*100:.2f}% sharpe={b3['sharpe']:.3f} maxdd={b3['maxdd']*100:.2f}%")
print(f"超额={(m3['cumret']-b3['cumret'])*100:.2f}pp, 超额Sharpe={m3['sharpe']-b3['sharpe']:.3f}")
results_rows.append(dict(leg="leg3_QQQ", **m3,
                         超额累计pp=(m3["cumret"]-b3["cumret"])*100,
                         超额Sharpe=m3["sharpe"]-b3["sharpe"],
                         baseline累计=f"{b3['cumret']*100:.2f}%", baseline_Sharpe=round(b3["sharpe"],3),
                         交易次数=sw3, 总换手x=round(to3,2), 成本拖累pp=0))
reg_stats["leg3"] = regime_stats(rec1, px3["QQQ"], "leg3")
plot_leg(3, (1+ret3).cumprod(), (1+base3).cumprod(),
         f"variant QQQ-core (+{m3['cumret']*100:.1f}%)", f"QQQ (+{b3['cumret']*100:.1f}%)",
         "Leg3: variant QQQ-core vs QQQ (2016-02→2026-09)", "equity_leg3_qqq.png",
         m3["maxdd"], b3["maxdd"])

# ============ save ============
out = pd.DataFrame(results_rows)
out.to_csv(os.path.join(VAL_DIR, "results_validation.csv"), index=False)
meta = {
    "leg1": {"说明": "主样本 2016-02-01→2026-09-17, 变体 + 单边5bps 佣金/滑点, 按实际换手逐月计(调仓首日从收益中扣除)", "规则": "11行业/阈值6/熊市top3/否则SPY, 与主样本一致",
             "baseline": "同周期 SPY buy-hold", "无未来函数": "每月末收盘决策, 次交易日生效",
             "成本拖累pp": round(drag_pp, 2), "regime统计": reg_stats["leg1"]},
    "leg2": {"说明": "样本外 1999-01→2016-01(实际最早可决策月份起算), 9只1998-12成立的行业SPDR(XLC/XLRE当时不存在, 排除)",
             "规则适配(测试前预设)": "熊市阈值改为有效候选中≥5/9过去6个月收益为负; 熊市时等权top3(9选3), 否则100%SPY",
             "baseline": "同周期 SPY buy-hold", "未计": "佣金/滑点/税", "无未来函数": "同上",
             "regime统计": reg_stats["leg2"]},
    "leg3": {"说明": "主样本窗口, 核心持有SPY→QQQ, regime判定仍用11个S&P行业ETF(规则不变)",
             "baseline": "同周期 QQQ buy-hold(yfinance复权)", "未计": "佣金/滑点/税", "无未来函数": "同上",
             "regime统计": reg_stats["leg3"]},
    "Sharpe": "rf=0, 252天年化",
}
with open(os.path.join(VAL_DIR, "meta.json"), "w") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2, default=str)

print("\n=== 汇总表 ===")
print(out.to_string(index=False, float_format="%.4f"))
print("\n=== regime 统计 ===")
print(json.dumps(reg_stats, ensure_ascii=False, indent=2))
