"""r3-fallen-angels 补充诊断：
1) 验证 auto_adjust 分红调整真实生效（对比 raw close）
2) 2因子回归 ANGL ~ HYG + IEF：久期暴露分解
3) 2022 利率冲击年分段；滚动3年超额为负的窗口定位
"""
import numpy as np, pandas as pd, yfinance as yf, os, json
OUT = os.path.dirname(os.path.abspath(__file__))

# --- 1) 分红调整验证 ---
raw = yf.download(["ANGL", "HYG"], start="2023-01-01", end="2024-01-01",
                  auto_adjust=False, progress=False, threads=True)
adj = yf.download(["ANGL", "HYG"], start="2023-01-01", end="2024-01-01",
                  auto_adjust=True, progress=False, threads=True)
rc, ac = raw["Close"]["ANGL"], adj["Close"]["ANGL"]
# ex-div 日：raw close 出现 ~0.4%+ 的单日跳空下跌、而 adj 无跳空
raw_drop = rc.pct_change()
big = raw_drop[raw_drop < -0.004]
print("2023 年 ANGL raw close 单日跌幅 >0.4% 的天数:", len(big), "(多为除息日跳空)")
if len(big):
    d = big.index[0]
    print(f"  例 {d.date()}: raw {rc.loc[d]/rc.shift(1).loc[d]-1:.2%} vs adj {ac.loc[d]/ac.shift(1).loc[d]-1:.2%}")
# 全年视角：raw 累计 vs adj 累计差 = 分红贡献
print(f"  2023 raw累计 {(rc.iloc[-1]/rc.iloc[0]-1):.2%} vs adj累计 {(ac.iloc[-1]/ac.iloc[0]-1):.2%} "
      f"→ 分红贡献约 {((ac.iloc[-1]/ac.iloc[0])-(rc.iloc[-1]/rc.iloc[0]))*100:.2f}pp/年 ( sanity check )")

# --- 2) 2因子回归：ANGL ~ HYG + IEF ---
px = yf.download(["ANGL", "HYG", "IEF"], start="2012-04-01", auto_adjust=True,
                 progress=False, threads=True)["Close"]
first = px["ANGL"].dropna().index[0]
px = px.loc[first:].dropna()
r = px.pct_change().dropna()
df = pd.DataFrame({"a": r["ANGL"], "h": r["HYG"], "i": r["IEF"]}).dropna()
X = np.column_stack([np.ones(len(df)), df["h"], df["i"]])
coef, *_ = np.linalg.lstsq(X, df["a"], rcond=None)
alpha_d, b_h, b_i = coef
yhat = X @ coef
r2 = 1 - ((df["a"] - yhat) ** 2).sum() / ((df["a"] - df["a"].mean()) ** 2).sum()
print(f"\n2因子回归 ANGL ~ HYG + IEF: beta_HYG={b_h:.3f}, beta_IEF={b_i:.3f}, "
      f"日alpha={alpha_d:.6f}(年化 {(alpha_d*252)*100:+.2f}pp), R2={r2:.3f}")
print("  (beta_IEF>0 且显著 => 久期更长于 HYG，获得利率因子暴露)")

# --- 3) 2022 利率冲击年 + 滚动超额为负窗口 ---
s_cum = pd.read_csv(os.path.join(OUT, "daily_equity.csv"), index_col=0, parse_dates=True)
s_cum.index = pd.to_datetime(s_cum.index)
se = (1 + s_cum["ANGL_cum"].pct_change().fillna(0))
be = (1 + s_cum["HYG_cum"].pct_change().fillna(0))
def seg_ret(col, a, b):
    # daily_equity.csv 存的是累计收益 cum；分段收益 = equity_end/equity_start - 1
    ss = s_cum.loc[a:b, col]
    eq0, eq1 = 1 + ss.iloc[0], 1 + ss.iloc[-1]
    return eq1 / eq0 - 1
for a, b, nm in [("2022-01-01", "2022-12-31", "2022 利率冲击年"),
                 ("2020-01-01", "2021-12-31", "2020–2021 降级潮+反弹")]:
    ts, tb = seg_ret("ANGL_cum", a, b), seg_ret("HYG_cum", a, b)
    print(f"{nm}: ANGL {ts:.2%} vs HYG {tb:.2%} | 超额 {(ts-tb)*100:+.2f}pp")
roll = pd.read_csv(os.path.join(OUT, "rolling3y_excess.csv"), index_col=0, parse_dates=True)
neg = roll[roll["excess"] < 0]
print(f"\n滚动3年超额为负的窗口数: {len(neg)}/{len(roll)} "
      f"({len(neg)/len(roll):.1%})，最早 {neg.index[0].date()} 最晚 {neg.index[-1].date()}"
      if len(neg) else "\n滚动3年超额无负窗口")
# 为负窗口的典型区间
if len(neg):
    print("为负窗口覆盖的3年区间示例(最早窗口):",
          (neg.index[0] - pd.DateOffset(years=3)).date(), "->", neg.index[0].date())

json.dump(dict(beta_HYG=float(b_h), beta_IEF=float(b_i), 年化alpha_pp=float(alpha_d*252*100),
               R2=float(r2)),
          open(os.path.join(OUT, "factor_decomp.json"), "w"), indent=2)
print("\n补充诊断完成")
