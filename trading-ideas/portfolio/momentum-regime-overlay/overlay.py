#!/usr/bin/env python3
"""动量熊市 regime overlay vs 100% SPY buy-and-hold.

主规格(预注册): 每月末计算 11 个行业过去 6 个月收益; 若其中 >=6 个为负
→ 判熊市 regime, 次月仓位 40% SPY + 60% 现金(现金收益记 0); 否则 100% SPY.
变体: 熊市 regime 时等权持有动量 top3 行业(复刻 2022 躲进 XLE 机制), 否则 100% SPY.
无未来函数. 样本 2016-02-01 → 2026-09-17.
"""
import json
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BASE = os.path.dirname(os.path.abspath(__file__))
SECTOR_DIR = os.path.expanduser("~/workspace/trading-ideas/sweeps/sector-momentum/data")
SPY_FILE = os.path.expanduser("~/workspace/trading-ideas/sweeps/putwrite/SPY_full.csv")
TICKERS = ["XLC","XLY","XLP","XLE","XLF","XLV","XLI","XLB","XLRE","XLK","XLU"]

START, END = "2016-02-01", "2026-09-17"

# ---------- load ----------
spy = pd.read_csv(SPY_FILE, parse_dates=["Date"]).set_index("Date").sort_index()
spy_px = spy["Close"].rename("SPY")
sectors = {}
for t in TICKERS:
    df = pd.read_csv(os.path.join(SECTOR_DIR, f"{t}_daily.csv"), parse_dates=["Date"])
    sectors[t] = df.set_index("Date")[t]
px = pd.DataFrame(sectors).join(spy_px, how="outer").sort_index()
px = px.loc["2015-06-01":END]   # 宽窗口: 月末动量需要 2015-08 起的数据; 样本从 START 起算
daily_ret = px.pct_change()

# ---------- month ends & momentum ----------
month_end = px.resample("M").last()          # 月末收盘(最后一个交易日)
month_ends = month_end.index
assert month_ends[0] <= pd.Timestamp("2016-01-31") and month_ends[-1] >= pd.Timestamp("2026-09-01")

records = []  # 每月末: 决策日, 下月生效的 regime/仓位
for i in range(6, len(month_ends)):
    d = month_ends[i]
    d6 = month_ends[i - 6]
    p_now = month_end.loc[d, TICKERS]
    p_old = month_end.loc[d6, TICKERS]
    mom = p_now / p_old - 1                    # 6 个月动量
    valid = mom.dropna()
    n_neg = int((valid < 0).sum())
    bear = n_neg >= 6                          # 预注册阈值
    ranked = valid.sort_values(ascending=False)
    top3 = list(ranked.head(3).index)
    records.append(dict(date=d, n_valid=len(valid), n_neg=n_neg,
                        bear=bool(bear), top3=top3,
                        mom={t: float(mom[t]) for t in valid.index}))
rec = pd.DataFrame(records).set_index("date")
# 生效: 决策日 d 的下个交易日起, 到下个决策日 d_next(含)
# ---------- portfolio construction ----------
def build(weights_fn):
    """weights_fn(row) -> dict{ticker: weight} for the month after decision date."""
    port_ret = pd.Series(index=px.index, dtype=float)
    regime_flag = pd.Series(index=px.index, dtype=float)
    for k, (d, row) in enumerate(rec.iterrows()):
        d_next = rec.index[k + 1] if k + 1 < len(rec) else px.index[-1]
        days = px.index[(px.index > d) & (px.index <= d_next)]
        if len(days) == 0:
            continue
        w = weights_fn(row)
        r = (daily_ret.loc[days, list(w.keys())] * pd.Series(w)).sum(axis=1)
        port_ret.loc[days] = r
        regime_flag.loc[days] = 1.0 if row["bear"] else 0.0
    port_ret = port_ret.loc[START:END].dropna()
    return port_ret, regime_flag.loc[port_ret.index]

def w_main(row):
    return {"SPY": 0.4} if row["bear"] else {"SPY": 1.0}      # 现金权重收益为 0
def w_variant(row):
    if row["bear"]:
        t3 = row["top3"]
        return {t: 1/3 for t in t3}
    return {"SPY": 1.0}

ret_main, reg_main = build(w_main)
ret_var, reg_var = build(w_variant)
ret_spy = daily_ret["SPY"].loc[ret_main.index]

# ---------- metrics ----------
def metrics(r, label):
    eq = (1 + r).cumprod()
    cumret = eq.iloc[-1] - 1
    yrs = (r.index[-1] - r.index[0]).days / 365.25
    cagr = eq.iloc[-1] ** (1/yrs) - 1
    sharpe = r.mean() / r.std() * np.sqrt(252) if r.std() > 0 else 0.0
    dd = (eq / eq.cummax() - 1)
    maxdd = dd.min()
    calmar = cagr / abs(maxdd) if maxdd < 0 else np.nan
    return dict(label=label, n=len(r), cumret=float(cumret), cagr=float(cagr),
                sharpe=float(sharpe), maxdd=float(maxdd), calmar=float(calmar),
                start=str(r.index[0].date()), end=str(r.index[-1].date()))

m_spy = metrics(ret_spy, "SPY buy-hold")
m_main = metrics(ret_main, "overlay 主规格 40%SPY+60%现金")
m_var = metrics(ret_var, "overlay 变体 top3行业")

def excess(m, base):
    return dict(cumret_pp=(m["cumret"]-base["cumret"])*100,
                sharpe_d=m["sharpe"]-base["sharpe"])

# ---------- slices ----------
def slice_perf(r, s, e):
    r2 = r.loc[s:e]
    eq = (1 + r2).cumprod()
    return float(eq.iloc[-1]-1), float((eq/eq.cummax()-1).min())

slices = {
    "2022全年": ("2022-01-01", "2022-12-31"),
    "2020-02-19→2020-03-23(快熊)": ("2020-02-19", "2020-03-23"),
    "2023-2026牛市": ("2023-01-01", "2026-09-17"),
    "2018-12": ("2018-12-01", "2018-12-31"),
}
slice_rows = []
for name, (s, e) in slices.items():
    for lab, r in [("SPY", ret_spy), ("主规格", ret_main), ("变体", ret_var)]:
        cr, mdd = slice_perf(r, s, e)
        slice_rows.append(dict(区间=name, 策略=lab, 累计收益=cr, 最大回撤=mdd))

# ---------- regime stats ----------
def regime_stats(reg, label):
    dec = rec["bear"].astype(int)
    switches = int((dec.diff().abs() == 1).sum())
    bear_months = rec[rec["bear"]]
    n_bear = len(bear_months)
    # 误伤: 熊市月份里 SPY 当月为正的比例
    me_spy = spy_px.resample("M").last().pct_change()
    false, total = 0, 0
    for d in bear_months.index:
        d_next = rec.index[rec.index.get_loc(d) + 1] if rec.index.get_loc(d) + 1 < len(rec) else None
        if d_next is None: continue
        mret = me_spy.loc[d_next]
        if pd.notna(mret):
            total += 1
            if mret > 0: false += 1
    return dict(label=label, regime_切换次数=switches, 熊市月份数=n_bear,
                误伤月份=false, 误伤分母=total,
                误伤率=(false/total if total else None),
                熊市决策日=[str(x.date()) for x in bear_months.index])

rs_main = regime_stats(reg_main, "主规格")
rs_var = regime_stats(reg_var, "变体")

# ---------- save ----------
out = pd.DataFrame([m_spy, m_main, m_var])
out["超额累计pp"] = out["cumret"].apply(lambda x: (x - m_spy["cumret"])*100)
out["超额Sharpe"] = out["sharpe"] - m_spy["sharpe"]
out.to_csv(os.path.join(BASE, "results.csv"), index=False)

sl = pd.DataFrame(slice_rows)
sl.to_csv(os.path.join(BASE, "slices.csv"), index=False)

meta = {
    "sample": f"{START} → {END}",
    "主规格(预注册)": "每月末算11行业过去6个月收益; ≥6个为负→熊市regime, 次月40%SPY+60%现金(现金收益0); 否则100%SPY",
    "变体": "熊市regime时等权持有动量top3行业, 否则100%SPY",
    "bear阈值说明": "XLC(2018-06成立)/XLRE早期NaN, 6m动量需要窗口两端有效值, 未满窗口月份不进候选池; 阈值按有效候选中的负收益个数≥6判定",
    "无未来函数": "每月末收盘算排名, 次个交易日起生效",
    "未计": "佣金/滑点/税; 现金收益记0(未计货币基金收益, 保守)",
    "Sharpe": "rf=0, 252天年化",
    "数据": "行业ETF: yfinance自动复权(复用sector-momentum); SPY: putwrite/SPY_full.csv(复权, 已校验2016-02-01→2026-09-17=+367.11%与前次一致)",
    "regime统计": {"主规格": rs_main, "变体": rs_var},
    "excess": {"主规格": excess(m_main, m_spy), "变体": excess(m_var, m_spy)},
}
with open(os.path.join(BASE, "meta.json"), "w") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2, default=str)

# ---------- plots ----------
eq_spy = (1 + ret_spy).cumprod()
eq_main = (1 + ret_main).cumprod()
eq_var = (1 + ret_var).cumprod()

fig, axes = plt.subplots(3, 1, figsize=(12, 10), sharex=True)
axes[0].plot(eq_spy.index, eq_spy, label=f"100% SPY (+{m_spy['cumret']*100:.1f}%)")
axes[0].plot(eq_main.index, eq_main, label=f"Overlay main 40/60 (+{m_main['cumret']*100:.1f}%)")
axes[0].plot(eq_var.index, eq_var, label=f"Overlay variant top3 (+{m_var['cumret']*100:.1f}%)")
axes[0].set_yscale("log"); axes[0].legend(); axes[0].set_title("Equity (log): momentum bear-regime overlay vs SPY buy-hold")
axes[0].grid(True, alpha=0.3)
for ax, eq, t in [(axes[1], eq_main, "main"), (axes[2], eq_var, "variant")]:
    dd = eq / eq.cummax() - 1
    dd_spy = eq_spy / eq_spy.cummax() - 1
    ax.fill_between(dd.index, dd*100, 0, alpha=0.5, label=f"{t} drawdown")
    ax.plot(dd_spy.index, dd_spy*100, color="gray", alpha=0.6, label="SPY drawdown")
    ax.legend(); ax.set_ylabel("drawdown %"); ax.grid(True, alpha=0.3)
fig.tight_layout()
fig.savefig(os.path.join(BASE, "equity.png"), dpi=100)
plt.close(fig)

fig, ax = plt.subplots(figsize=(12, 3.5))
ax.plot(eq_spy.index, eq_spy / eq_spy.iloc[0], color="gray", alpha=0.5, label="SPY (norm)")
bear_days = reg_main[reg_main == 1].index
for d in bear_days:
    ax.axvspan(d, d + pd.Timedelta(days=1), color="red", alpha=0.15, linewidth=0)
ax.set_title("Bear-regime months (red shading), main spec")
ax.legend(); ax.grid(True, alpha=0.3)
fig.tight_layout()
fig.savefig(os.path.join(BASE, "regime_timeline.png"), dpi=100)
plt.close(fig)

# 交易次数: 月度调仓(仓位变化)次数
def trade_counts(weights_fn, label):
    prev = None; n_reb = 0; n_switch = 0
    for d, row in rec.iterrows():
        w = weights_fn(row)
        key = tuple(sorted((k, round(v, 6)) for k, v in w.items()))
        if prev is not None and key != prev:
            n_reb += 1
        prev = key
    return n_reb
tr_main, tr_var = trade_counts(w_main, "main"), trade_counts(w_variant, "var")

print("=== 完整指标 ===")
print(out.to_string(index=False, float_format="%.4f"))
print("\n=== regime 统计 ===")
print(json.dumps({"主规格": rs_main, "变体": rs_var}, ensure_ascii=False, indent=2)[:2000])
print("\n=== 区间表现 ===")
print(sl.to_string(index=False, float_format="%.4f"))
print(f"\n月度调仓(仓位变化)次数: 主规格={tr_main}, 变体={tr_var}; 决策月数={len(rec)}")
