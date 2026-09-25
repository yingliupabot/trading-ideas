"""r3-fallen-angels: 堕落天使强制抛售反转
规则：买入并持有 ANGL (VanEck Fallen Angel High Yield Bond ETF, 2012-04 成立)。
机制：IG 指数基金/保险/养老金在评级掉到 HY 后因章程禁止持有而被迫抛售
     （Ben Dor & Xu 2011; ECB 2020），评级门槛结构性、永远存在。
     r2-credit-etf-momentum 是 LQD/HYG/IEF 动量轮动（趋势跟踪），本策略是
     事件驱动的强制抛售反转——逻辑完全不同。
数据：yfinance 日线，auto_adjust=True（经分红调整：债券 ETF 票息是收益大头）。
      ANGL 成立日 (2012-04) 之前的日期直接剔除，不外推。
Baseline: buy-hold HYG，同一窗口。
成本：单边 5bps，buy-hold 只计初始建仓一次。
"""
import numpy as np, pandas as pd, yfinance as yf, json, os
OUT = os.path.dirname(os.path.abspath(__file__))
COST = 0.0005  # 单边 5bps
START = "2012-01-01"

raw = yf.download(["ANGL", "HYG"], start=START, auto_adjust=True,
                  progress=False, threads=True)
print("columns:", raw.columns.tolist()[:4])
px = raw["Close"].dropna(how="all")
# 防前视/防外推：ANGL 成立日之前的日期直接剔除
first_angl = px["ANGL"].dropna().index[0]
first_hyg = px["HYG"].dropna().index[0]
print("ANGL first date:", first_angl.date(), "| HYG first date:", first_hyg.date())
win_start = max(first_angl, first_hyg)
px = px.loc[win_start:].dropna()
print("样本区间:", px.index[0].date(), "->", px.index[-1].date(), "rows:", len(px))

rets = px.pct_change()
# buy-hold：第一天收盘建仓，一次性扣 5bps
strat_ret = rets["ANGL"].copy()
strat_ret.iloc[0] -= COST
bh_ret = rets["HYG"]  # baseline 不扣成本（r2 同样口径，更保守）
s_cum = (1 + strat_ret).cumprod() - 1
b_cum = (1 + bh_ret).cumprod() - 1

def ann(r, idx):
    yrs = (idx[-1] - idx[0]).days / 365.25
    return (1 + r) ** (1 / yrs) - 1

def sharpe(r):
    r = r.dropna()
    return np.sqrt(252) * r.mean() / r.std()

def maxdd(cum):
    eq = 1 + cum
    return ((eq / eq.cummax()) - 1).min()

idx = px.index
tot_s, tot_b = s_cum.iloc[-1], b_cum.iloc[-1]
excess_pp = (tot_s - tot_b) * 100
print("\n====== 主结果 ======")
print(f"样本区间: {idx[0].date()} -> {idx[-1].date()}")
print(f"ANGL 累计: {tot_s:.2%}  (年化 {ann(tot_s, idx):.2%})")
print(f"HYG  累计: {tot_b:.2%}  (年化 {ann(tot_b, idx):.2%})")
print(f"超额: {excess_pp:+.2f}pp (已扣成本)")
print(f"Sharpe: ANGL {sharpe(strat_ret):.3f} vs HYG {sharpe(bh_ret):.3f}")
print(f"最大回撤: ANGL {maxdd(s_cum):.2%} vs HYG {maxdd(b_cum):.2%}")
print("交易次数: 1（初始建仓）")
win = (tot_s > tot_b) and (sharpe(strat_ret) > sharpe(bh_ret)) and (excess_pp >= 10)
print("判决:", "WIN" if win else "FAIL")

# ---------- 分样本：2012–2019 vs 2020–2026 ----------
print("\n====== 分样本 ======")
for a, b, nm in [("2012-01-01", "2019-12-31", "2012–2019（成立→疫情前）"),
                 ("2020-01-01", "2026-12-31", "2020–2026（含降级潮）")]:
    ss = strat_ret.loc[a:b]; sb = bh_ret.loc[a:b]
    if len(ss) < 10:
        print(nm, "数据不足，跳过"); continue
    ts, tb = (1 + ss).prod() - 1, (1 + sb).prod() - 1
    print(f"{nm}: ANGL {ts:.2%} (Sharpe {sharpe(ss):.3f}, DD {maxdd((1+ss).cumprod()-1):.2%}) | "
          f"HYG {tb:.2%} (Sharpe {sharpe(sb):.3f}, DD {maxdd((1+sb).cumprod()-1):.2%}) | "
          f"超额 {(ts-tb)*100:+.2f}pp")

# ---------- 2020-03 降级潮回撤深度对比 ----------
print("\n====== 2020-03 降级潮：回撤深度对比 ======")
ev = strat_ret.loc["2020-01-01":"2020-06-30"]
s_eq = (1 + ev).cumprod()
b_eq = (1 + bh_ret.loc["2020-01-01":"2020-06-30"]).cumprod()
print(f"2020-01→2020-06 区间最大回撤: ANGL {((s_eq/s_eq.cummax())-1).min():.2%} vs HYG {((b_eq/b_eq.cummax())-1).min():.2%}")
# 具体到 2020-02-19(市场高点)→2020-03-23(低点) 窗口
for w0, w1, nm in [("2020-02-19", "2020-03-23", "2020-02-19→03-23（峰→谷）"),
                   ("2020-03-23", "2020-06-30", "2020-03-23→06-30（反弹段）")]:
    ss2 = strat_ret.loc[w0:w1]; sb2 = bh_ret.loc[w0:w1]
    print(f"{nm}: ANGL {(1+ss2).prod()-1:.2%} | HYG {(1+sb2).prod()-1:.2%} | 差 {( ((1+ss2).prod()-1)-((1+sb2).prod()-1) )*100:+.2f}pp")

# ---------- 滚动 3 年超额：溢价是否持续 ----------
print("\n====== 滚动 3 年超额（756 交易日）======")
W = 756
s_eq_full = (1 + strat_ret).cumprod()
b_eq_full = (1 + bh_ret).cumprod()
roll_exc = s_eq_full / s_eq_full.shift(W) - b_eq_full / b_eq_full.shift(W)
roll_exc = roll_exc.dropna()
print(f"滚动3年超额均值 {(roll_exc.mean())*100:+.2f}pp | 中位数 {(roll_exc.median())*100:+.2f}pp | "
      f"为正比例 {(roll_exc>0).mean():.1%} | 最小 {(roll_exc.min())*100:+.2f}pp | 最大 {(roll_exc.max())*100:+.2f}pp")
roll_exc.to_csv(os.path.join(OUT, "rolling3y_excess.csv"), header=["excess"])

# ---------- 风险暴露分解：beta vs alpha ----------
print("\n====== 风险暴露分解（日收益回归 ANGL ~ HYG）======")
df = pd.DataFrame({"angl": strat_ret, "hyg": bh_ret}).dropna()
X = np.column_stack([np.ones(len(df)), df["hyg"]])
coef, *_ = np.linalg.lstsq(X, df["angl"], rcond=None)
alpha_d, beta = coef
yhat = X @ coef
r2 = 1 - ((df["angl"] - yhat) ** 2).sum() / ((df["angl"] - df["angl"].mean()) ** 2).sum()
corr = df["angl"].corr(df["hyg"])
print(f"beta(HYG) = {beta:.3f} | 日 alpha = {alpha_d:.6f} (年化约 {(alpha_d*252)*100:+.2f}pp) | R² = {r2:.3f} | corr = {corr:.3f}")
print("含义: 若 beta>1 且 alpha≈0，则超额主要是更高 beta 的补偿，不是 alpha。")

# ---------- 存产物 ----------
res = dict(
    样本区间=[str(idx[0].date()), str(idx[-1].date())],
    ANGL累计收益=float(tot_s), HYG累计收益=float(tot_b),
    超额pp=float(excess_pp),
    ANGL_Sharpe=float(sharpe(strat_ret)), HYG_Sharpe=float(sharpe(bh_ret)),
    ANGL_最大回撤=float(maxdd(s_cum)), HYG_最大回撤=float(maxdd(b_cum)),
    交易次数=1, 成本单边="5bps(初始建仓)",
    判决="WIN" if win else "FAIL",
    滚动3年超额_均值pp=float(roll_exc.mean()*100),
    滚动3年超额_为正比例=float((roll_exc>0).mean()),
    beta_HYG=float(beta), 日alpha=float(alpha_d), R2=float(r2), corr=float(corr),
    数据说明="yfinance auto_adjust=True（分红调整后）; ANGL 2012-04 成立，成立前日期剔除无外推",
)
with open(os.path.join(OUT, "results.json"), "w") as f:
    json.dump(res, f, indent=2, ensure_ascii=False)
pd.DataFrame([{
    "ANGL累计": f"{tot_s:.2%}", "HYG累计": f"{tot_b:.2%}", "超额pp": f"{excess_pp:+.2f}",
    "ANGL Sharpe": f"{sharpe(strat_ret):.3f}", "HYG Sharpe": f"{sharpe(bh_ret):.3f}",
    "ANGL 最大回撤": f"{maxdd(s_cum):.2%}", "HYG 最大回撤": f"{maxdd(b_cum):.2%}",
    "样本区间": f"{idx[0].date()} -> {idx[-1].date()}", "交易次数": 1, "判决": "WIN" if win else "FAIL",
}]).to_csv(os.path.join(OUT, "results.csv"), index=False)
pd.DataFrame({"ANGL_cum": s_cum, "HYG_cum": b_cum}).to_csv(os.path.join(OUT, "daily_equity.csv"))
print("\n结果已存:", OUT)

# ---------- 图 ----------
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, axes = plt.subplots(2, 1, figsize=(10, 8), sharex=True)
ax = axes[0]
ax.plot(idx, (1 + s_cum).values, label=f"ANGL buy-hold ({tot_s:.1%})")
ax.plot(idx, (1 + b_cum).values, label=f"HYG buy-hold ({tot_b:.1%})")
ax.axvspan(pd.Timestamp("2020-02-19"), pd.Timestamp("2020-06-30"), color="gray", alpha=0.15)
ax.set_title("r3-fallen-angels: ANGL buy-hold vs HYG buy-hold (total return, dividend-adjusted)")
ax.legend(); ax.grid(alpha=0.3)
ax2 = axes[1]
ax2.plot(roll_exc.index, roll_exc.values * 100)
ax2.axhline(0, color="black", lw=0.8)
ax2.set_title("Rolling 3-year excess return ANGL-HYG (pp)")
ax2.set_ylabel("pp"); ax2.grid(alpha=0.3)
fig.tight_layout(); fig.savefig(os.path.join(OUT, "equity.png"), dpi=100)
print("图已存 equity.png")
