#!/usr/bin/env python3
"""Post-hoc robustness: grid over formation / bear-threshold / topN for variant & main.
事后稳健性检验(非预注册, 明确标注): 变体是否只在特定参数格子上赢。"""
import os
import numpy as np
import pandas as pd

SECTOR_DIR = os.path.expanduser("~/workspace/trading-ideas/sweeps/sector-momentum/data")
SPY_FILE = os.path.expanduser("~/workspace/trading-ideas/sweeps/putwrite/SPY_full.csv")
TICKERS = ["XLC","XLY","XLP","XLE","XLF","XLV","XLI","XLB","XLRE","XLK","XLU"]
START, END = "2016-02-01", "2026-09-17"

spy = pd.read_csv(SPY_FILE, parse_dates=["Date"]).set_index("Date").sort_index()["Close"].rename("SPY")
sectors = {}
for t in TICKERS:
    df = pd.read_csv(os.path.join(SECTOR_DIR, f"{t}_daily.csv"), parse_dates=["Date"])
    sectors[t] = df.set_index("Date")[t]
px = pd.DataFrame(sectors).join(spy, how="outer").sort_index().loc["2015-06-01":END]
daily_ret = px.pct_change()
month_end = px.resample("M").last()
month_ends = month_end.index

def run(formation, thresh, topn, mode):
    recs = []
    for i in range(formation, len(month_ends)):
        d, d_old = month_ends[i], month_ends[i - formation]
        mom = (month_end.loc[d, TICKERS] / month_end.loc[d_old, TICKERS] - 1).dropna()
        bear = (mom < 0).sum() >= thresh
        recs.append((d, bool(bear), list(mom.sort_values(ascending=False).head(topn).index)))
    port = pd.Series(index=px.index, dtype=float)
    for k, (d, bear, topk) in enumerate(recs):
        d_next = recs[k+1][0] if k+1 < len(recs) else px.index[-1]
        days = px.index[(px.index > d) & (px.index <= d_next)]
        if len(days) == 0: continue
        if not bear:
            w = {"SPY": 1.0}
        elif mode == "main":
            w = {"SPY": 0.4}
        else:
            w = {t: 1/topn for t in topk}
        port.loc[days] = (daily_ret.loc[days, list(w)] * pd.Series(w)).sum(axis=1)
    port = port.loc[START:END].dropna()
    eq = (1 + port).cumprod()
    sharpe = port.mean()/port.std()*np.sqrt(252)
    return float(eq.iloc[-1]-1), float(sharpe)

spy_r = daily_ret["SPY"].loc[START:END].dropna()
spy_eq = (1+spy_r).cumprod()
spy_cum, spy_sh = float(spy_eq.iloc[-1]-1), float(spy_r.mean()/spy_r.std()*np.sqrt(252))
print(f"baseline SPY: cumret={spy_cum*100:.2f}% sharpe={spy_sh:.4f}\n")

rows = []
for formation in (6, 12):
    for thresh in (5, 6, 7):
        for mode, topns in (("main",[None]), ("variant",[2,3,4])):
            for topn in topns:
                cum, sh = run(formation, thresh, topn or 3, mode)
                rows.append(dict(mode=mode, formation=formation, thresh=thresh, topn=topn,
                                 cumret=cum, sharpe=sh,
                                 exc_pp=(cum-spy_cum)*100, exc_sh=sh-spy_sh,
                                 win_both=(cum>spy_cum and sh>spy_sh)))
df = pd.DataFrame(rows)
print(df.to_string(index=False, float_format="%.4f"))
print("\nvariant win-both cells:", int((df[(df['mode']=='variant')]['win_both']).sum()), "/", int((df['mode']=='variant').shape[0]))
