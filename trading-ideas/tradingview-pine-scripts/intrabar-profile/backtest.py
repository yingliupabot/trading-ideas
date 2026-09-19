"""
Intrabar Profile [Kioseff Trading] — Python 复刻与演示回测.

(a) 逻辑验证:按作者 Pine v6 源码逐行复刻 intrabar profile 重建
    (request.security_lower_tf 取低级别数据,rows=11,POC,70% value area),
    并做 sanity 检查。
(b) 演示策略:基于日线 profile 的 value-area 突破(收盘相对 POC/VA 的位置),
    用作者默认参数(rows=11,VA 70%,granularity=1m 映射到本实验的 60m LTF)。
    Baseline:同区间 SPY buy-and-hold(仓库 AGENT.md 规则)。

作者算法要点(源码 intrabar-profile.pine):
- 每根 chart bar 内:Range=(high-low)/(rows-1),levels=low+Range*i (i=0..rows-1)
- 每根 LTF bar:带符号成交量 data=volume*sign(close-close[1])
  (tick 级用 bid/ask,此处用小时 K 方向近似);bot/top=binary_search_leftmost
  定位 LTF high/low 在 levels 中的档位;div=data/(|top-bot|+1);
  vp[bot..top]+=|div|, delta[bot..top]+=div
- POC=argmax(vp);value area 从 POC 向两侧扩展直到覆盖 70% 总量
- 注意:作者的 VA 灰显条件是 i<=indDn 或 i>=indUp(视觉上有 off-by-one),
  本复刻取循环结束时的累积区间 [indDn, indUp] 为价值区,并在笔记中说明。

诚实近似:delta 用小时 K 涨跌方向估算,不是交易所真实 bid/ask tick
(作者在脚本说明里也承认这是估算)。无手续费/滑点建模。一次一笔,无杠杆。

数据:data/SPY_1h.csv (yfinance,2 年小时线,已存盘)。
"""
import bisect

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data"
ASSETS = HERE / "assets"
ASSETS.mkdir(exist_ok=True)
NOTIONAL = 10_000
ROWS = 11          # 作者默认 rows
VA_PCT = 0.70      # 作者 value area 覆盖比例


# ---------------- 数据 ----------------
def load_hourly():
    df = pd.read_csv(DATA / "SPY_1h.csv", index_col=0, parse_dates=True)
    df.index = pd.to_datetime(df.index, utc=True).tz_convert("America/New_York")
    return df


def to_daily(df):
    g = df.resample("1D")
    d = pd.DataFrame({
        "Open": g["Open"].first(), "High": g["High"].max(),
        "Low": g["Low"].min(), "Close": g["Close"].last(),
        "Volume": g["Volume"].sum(),
    }).dropna()
    return d


# ---------------- 作者算法复刻 ----------------
def intrabar_profile(chart_o, chart_h, chart_l, chart_c, ltf):
    """ltf: DataFrame(Open,High,Low,Close,Volume,signed_vol),返回 dict。"""
    rng = (chart_h - chart_l) / (ROWS - 1) if chart_h > chart_l else 0.0
    levels = np.array([chart_l + rng * i for i in range(ROWS)])
    vp = np.zeros(ROWS)
    delta = np.zeros(ROWS)
    for _, r in ltf.iterrows():
        data = r["signed_vol"]
        bot = bisect.bisect_left(levels, r["Low"])
        top = bisect.bisect_left(levels, r["High"])
        bot = min(max(bot, 0), ROWS - 1)
        top = min(max(top, 0), ROWS - 1)
        span = abs(top - bot) + 1
        div = data / span
        absdiv = abs(div)
        for x in range(bot, top + 1):
            vp[x] += absdiv
            delta[x] += div
    poc = int(np.argmax(vp))          # Pine indexof(max) 取第一个最大值
    # 作者的 VA 扩展循环(逐行直译)
    ind_up = ind_dn = poc
    s = 0.0
    total = vp.sum() * VA_PCT
    for _ in range(ROWS):
        if ind_up == ind_dn:
            s += vp[ind_up]
            if s >= total:
                break
            ind_up += 1
            ind_dn -= 1
            continue
        if ind_up < ROWS:
            s += vp[ind_up]
            if s >= total:
                break
            ind_up += 1
        if ind_dn > -1:
            s += vp[ind_dn]
            if s >= total:
                break
            ind_dn -= 1
    va_lo = max(ind_dn, 0)          # VA 可能扩展到数组边界之外,钳制
    va_hi = min(ind_up, ROWS - 1)
    return {
        "levels": levels, "vp": vp, "delta": delta, "poc": poc,
        "va_lo": va_lo, "va_hi": va_hi,
        "poc_px": levels[poc],
        "val": levels[va_lo], "vah": levels[va_hi] + rng,
        "total_vp": vp.sum(),
    }


def build_profiles(daily, hourly):
    """对每根日线 bar,用其内部小时线重建 profile。"""
    hourly = hourly.copy()
    hourly["signed_vol"] = hourly["Volume"] * np.sign(
        hourly["Close"] - hourly["Close"].shift(1)).fillna(0)
    hourly["date"] = hourly.index.date
    rows = []
    for ts, d in daily.iterrows():
        ltf = hourly[hourly["date"] == ts.date()]
        p = intrabar_profile(d["Open"], d["High"], d["Low"], d["Close"], ltf)
        p["date"] = ts
        p["n_ltf"] = len(ltf)
        rows.append(p)
    return pd.DataFrame(rows).set_index("date")


# ---------------- sanity 检查 ----------------
def sanity_check(prof, hourly):
    hourly = hourly.copy()
    hourly["signed_vol"] = hourly["Volume"] * np.sign(
        hourly["Close"] - hourly["Close"].shift(1)).fillna(0)
    hourly["date"] = hourly.index.date
    errs = []
    for ts, p in prof.iterrows():
        ltf = hourly[hourly["date"] == ts.date()]
        exp_vp = ltf["signed_vol"].abs().sum()
        exp_delta = ltf["signed_vol"].sum()
        # 1) vp 总量 == |带符号成交量| 之和
        errs.append(abs(p["total_vp"] - exp_vp))
        # 2) POC 档成交量最大
        assert p["vp"][p["poc"]] == p["vp"].max(), f"{ts} POC 不是最大值"
        # 3) VA 覆盖 >=70%
        va_cov = p["vp"][p["va_lo"]:p["va_hi"] + 1].sum() / p["total_vp"]
        assert va_cov >= VA_PCT - 1e-9, f"{ts} VA 覆盖不足 {va_cov:.3f}"
        # 4) POC/VA 价格合理性
        assert p["val"] <= p["poc_px"] <= p["vah"], f"{ts} POC 不在 VA 内"
        # 5) delta 总量 == 带符号成交量之和(符号守恒)
        assert abs(p["delta"].sum() - exp_delta) < 1e-6, f"{ts} delta 不守恒"
    print(f"sanity: {len(prof)} 根日线,全部通过 "
          f"(vp 总量最大绝对误差 {max(errs):.2e})")


# ---------------- 演示策略 ----------------
def demo_strategy(daily, prof):
    """规则(收盘已知,无未来函数):
    - 日收盘 > 当日 VAH(价值区上沿) → 次日做多(高于价值区被接受,动量延续)
    - 日收盘 < 当日 VAL(价值区下沿) → 次日做空(低于价值区被接受,动量延续)
    - 收盘在价值区内 → 空仓
    执行:信号日收盘进、次日收盘出,持有 1 天。$10k 名义本金,无杠杆,无费用。
    """
    sig = pd.Series(0, index=daily.index)
    sig[prof["vah"] < daily["Close"]] = 1    # close > VAH
    sig[prof["val"] > daily["Close"]] = -1   # close < VAL
    pos = sig.shift(1).fillna(0)             # 信号次日生效
    day_ret = daily["Close"].pct_change().fillna(0)
    strat_ret = pos * day_ret
    eq = NOTIONAL * (1 + strat_ret).cumprod()

    trades = strat_ret[pos != 0]
    n = int((pos != 0).sum())
    wins = trades[trades > 0]
    res = {
        "n": n,
        "win_rate": round(100 * (trades > 0).mean(), 2) if n else 0.0,
        "total_ret_%": round(100 * (eq.iloc[-1] / NOTIONAL - 1), 2),
        "avg_trade_%": round(100 * trades.mean(), 3) if n else 0.0,
        "profit_factor": round(wins.sum() / abs(trades[trades < 0].sum()), 2)
        if n and (trades < 0).any() and len(wins) else float("inf"),
        "max_dd_%": round(100 * (eq / eq.cummax() - 1).min(), 2),
        "bars": len(daily),
        "buy_hold_SPY_%": round(
            100 * (daily["Close"].iloc[-1] / daily["Close"].iloc[0] - 1), 2),
    }
    res["excess_vs_SPY_%"] = round(res["total_ret_%"] - res["buy_hold_SPY_%"], 2)
    res["period"] = f"{daily.index[0].date()} -> {daily.index[-1].date()}"
    return res, eq, pos


# ---------------- 图 ----------------
def plot_equity(daily, eq, res):
    spy_eq = NOTIONAL * daily["Close"] / daily["Close"].iloc[0]
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(eq.index, eq.values, label="Intrabar-profile demo strategy")
    ax.plot(spy_eq.index, spy_eq.values, label="Buy-hold SPY (baseline)",
            linestyle="--")
    ax.set_title("Intrabar Profile demo strategy vs SPY baseline")
    ax.set_ylabel("Equity ($)")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(ASSETS / "equity_curve.png", dpi=100)
    plt.close(fig)


def plot_profile_example(daily, prof):
    # 取近 90 天里波幅最大的一天做示例("大 K 线 + profile" 最有信息量)
    recent = daily.iloc[-90:]
    day = recent.loc[(recent["High"] - recent["Low"]).idxmax()]
    p = prof.loc[day.name]
    levels, vp = p["levels"], p["vp"]
    mids = levels + (levels[1] - levels[0]) / 2 if len(levels) > 1 else levels
    colors = ["#e5ff55" if i == p["poc"] else
              ("#4da3ff" if p["va_lo"] <= i <= p["va_hi"] else "#888888")
              for i in range(ROWS)]
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.barh(mids, vp, height=(levels[1] - levels[0]) * 0.9, color=colors,
            edgecolor="black", linewidth=0.4)
    ax.axhline(p["val"], color="gray", linestyle="--", linewidth=1)
    ax.axhline(p["vah"], color="gray", linestyle="--", linewidth=1)
    ax.set_title(f"SPY {day.name.date()} intrabar profile (11 rows, VA 70%)\n"
                 f"POC={p['poc_px']:.2f}  VAL={p['val']:.2f}  VAH={p['vah']:.2f}  "
                 f"(yellow=POC, blue=value area)")
    ax.set_xlabel("Volume (per row)")
    ax.set_ylabel("Price")
    fig.tight_layout()
    fig.savefig(ASSETS / "profile_example.png", dpi=100)
    plt.close(fig)
    print("example day:", day.name.date(),
          f"O={day['Open']:.2f} H={day['High']:.2f} "
          f"L={day['Low']:.2f} C={day['Close']:.2f}")


# ---------------- run ----------------
def main():
    hourly = load_hourly()
    daily = to_daily(hourly)
    print(f"daily bars: {len(daily)}, {daily.index[0].date()} -> "
          f"{daily.index[-1].date()}")

    prof = build_profiles(daily, hourly)
    sanity_check(prof, hourly)

    res, eq, pos = demo_strategy(daily, prof)
    print(pd.DataFrame([res]).T)

    pd.DataFrame([{k: (round(v, 2) if isinstance(v, float) else v)
                   for k, v in res.items()}]).to_csv(HERE / "results.csv",
                                                    index=False)
    plot_equity(daily, eq, res)
    plot_profile_example(daily, prof)
    print("saved results.csv + assets/equity_curve.png + "
          "assets/profile_example.png")


if __name__ == "__main__":
    main()
