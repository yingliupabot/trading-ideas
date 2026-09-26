"""r5-cef-discount-quintile:封闭式基金折价五分位 —— 按笔记规则重建的回测

!! 先读这一段 !!
原始回测脚本从没进过仓库(只提交了结果和图)。这个文件是 2026-09-26 照
meta.json / index.html 写明的规则**重建**的,**还没有在真实数据上跑过**:
写它的环境连不上 CEFConnect 和 Yahoo。机制本身用 --selftest 在合成数据上验过
(见文末 selftest:恒等、埋信号、前视陷阱、成本、baseline 漂移五项)。
要让这条 win 的证据落地,在有网的机器上:
    1) 按下面"输入"一节备好两份 CSV
    2) python backtest.py --discounts discounts.csv --prices prices.csv
    3) 把打印出来的数和 meta.json 对:主结果_扣成本 cumret 5.4863 / Sharpe 0.9884,
       baseline_EW_CEF cumret 1.9255,excess_pp 356.08,n_rebalance 176。
对上了,这个文件就是可复现的证据;对不上,差在哪儿本身就是要查的东西。

规则(meta.json「规则」原文):每月末按折价深度排序,做多折价最深五分位(约 50 只),
      等权,月度调仓;次月首个交易日收盘执行(无前视)。
信号:折价为周频,月末信号取当月最后一条已发布的周数据。
Universe:CEFConnect 当前在列、且 2011-06 之前就有折价数据的基金(原稿 250 只)。
      —— 当前在列 = 幸存者偏差;策略与 baseline 共用同一 universe,超额受影响小于绝对收益。
Baseline:同一 universe 等权,第一天买入后不再平衡(权重自然漂移),不扣成本。
成本:单边 5bps,按"上一期漂移后的真实权重 vs 新目标权重"的换手计。
样本:2012-01-03 → 2026-08-31(信号从 2011-12 月末起)。
Sharpe:月频收益,rf=0,×√12 年化。

输入(两份长表 CSV,表头照写):
    discounts.csv  date,ticker,discount     周频;discount 为百分数,负数=低于 NAV 交易
    prices.csv     date,ticker,adj_close    日频;含分红复权收盘价(原稿用 Yahoo Adj Close)

kill-gate(剔除贡献最大的三个 12 个月窗口)两种算法都打印:
    原稿里 worker 第一版按"log 加和"算,去三窗口后判 FAIL(Sharpe 0.58 < 0.63);
    协调员按"简单收益"重算判 PASS(1.0 vs 0.67)。两次计算都不在仓库里,
    差别大到不像只是口径不同 —— 这里把两种算法写死、并排打印,跑一遍就知道分歧在哪。
"""
import argparse, json, math, sys
import numpy as np
import pandas as pd

COST = 0.0005                       # 单边 5bps
UNIVERSE_CUTOFF = "2011-06-01"      # 这之前就有折价数据,才进 universe
FIRST_SIGNAL = "2011-12"            # 2011-12 月末的信号,2012-01 首个交易日执行
LAST_SIGNAL = "2026-07"             # 2026-07 月末信号,持有到 2026-08 末附近
STALE_DAYS = 10                     # 周频数据:月末往前 10 天内没有新数,当月不给信号


# ---------------------------------------------------------------- 引擎
def monthly_signals(disc, first=FIRST_SIGNAL, last=LAST_SIGNAL, stale_days=STALE_DAYS):
    """disc: 长表 date,ticker,discount。返回 {月份 Period: Series(ticker -> 折价)}。
    只用月末当天及之前发布的数;太旧(> stale_days)的不算当月信号。"""
    disc = disc.sort_values("date")
    out = {}
    for m in pd.period_range(first, last, freq="M"):
        end = m.to_timestamp(how="end").normalize()
        lo = end - pd.Timedelta(days=stale_days)
        w = disc[(disc["date"] <= end) & (disc["date"] >= lo)]
        if w.empty:
            continue
        out[m] = w.groupby("ticker")["discount"].last()
    return out


def execution_days(px_index, months):
    """信号月 m 的执行日 = m+1 月的第一个交易日。"""
    days = {}
    idx = pd.DatetimeIndex(px_index)
    for m in months:
        nxt = (m + 1)
        mask = (idx >= nxt.start_time) & (idx <= nxt.end_time)
        if mask.any():
            days[m] = idx[mask][0]
    return days


def pick(signal, tradable, frac=0.2):
    """折价最深(最负)的那一档。frac=0.2 五分位,0.1 十分位,1/3 三分位。"""
    s = signal[signal.index.isin(tradable)].dropna()
    if s.empty:
        return []
    n = max(1, int(round(len(s) * frac)))
    return list(s.sort_values().index[:n])


def run(disc, px, frac=0.2, universe=None, cost=COST):
    """返回 dict:月度收益、baseline 月度收益、换手、持仓记录。
    px: 宽表 index=交易日 columns=ticker,值为复权收盘价。"""
    if universe is None:
        first_seen = disc.groupby("ticker")["date"].min()
        universe = sorted(set(first_seen[first_seen < UNIVERSE_CUTOFF].index) & set(px.columns))
    px = px[universe].sort_index()
    sig = monthly_signals(disc[disc["ticker"].isin(universe)])
    months = sorted(sig)
    ex = execution_days(px.index, months)
    months = [m for m in months if m in ex]
    exd = [ex[m] for m in months]

    # 持有期:执行日 i 收盘 → 执行日 i+1 收盘;最后一个执行日没有下一期,不算
    rets, turns, costs, holds = [], [], [], []
    w_prev = pd.Series(dtype=float)
    for i in range(len(months) - 1):
        d0, d1 = exd[i], exd[i + 1]
        p0, p1 = px.loc[d0], px.loc[d1]
        tradable = p0.dropna().index
        names = pick(sig[months[i]], tradable, frac)
        target = pd.Series(1.0 / len(names), index=names) if names else pd.Series(dtype=float)
        # 换手:上一期持仓在本执行日的漂移权重 vs 新目标
        drift = w_prev
        allk = target.index.union(drift.index)
        turn = (target.reindex(allk, fill_value=0) - drift.reindex(allk, fill_value=0)).abs().sum()
        c = cost * turn
        # 持有期收益:退市/缺价 → 沿用最后可得价格(收益记 0)
        p1f = p1.copy()
        miss = p1f[target.index].isna()
        if miss.any():
            last = px.loc[:d1, target.index[miss]].ffill().iloc[-1]
            p1f[target.index[miss]] = last
        r_i = (p1f[target.index] / p0[target.index] - 1.0)
        port = float((target * r_i).sum())
        rets.append((1.0 - c) * (1.0 + port) - 1.0)
        turns.append(turn); costs.append(c); holds.append(names)
        # 期末漂移权重,留给下一期算换手
        grown = target * (1.0 + r_i)
        w_prev = grown / grown.sum() if grown.sum() > 0 else pd.Series(dtype=float)

    # baseline:第一天等权买入全 universe,之后不动
    d_start = exd[0]
    live = px.loc[d_start].dropna().index
    base_px = px.loc[:, live].ffill()
    base_val = (base_px.loc[exd] / base_px.loc[d_start]).mean(axis=1)   # 等权 buy-hold 的净值 = 各只增长倍数的均值
    base_rets = base_val.pct_change().dropna().values

    dates = exd[1:]
    return {"dates": dates, "rets": np.array(rets), "base": np.array(base_rets[:len(rets)]),
            "turnover": np.array(turns), "costs": np.array(costs), "holds": holds,
            "universe": universe, "months": months[:-1]}


# ---------------------------------------------------------------- 指标
def stats(r):
    r = np.asarray(r, float)
    v = np.cumprod(1 + r)
    n = len(r)
    sd = r.std(ddof=1) if n > 1 else float("nan")
    dd = (v / np.maximum.accumulate(v) - 1).min() if n else float("nan")
    return {"cumret": float(v[-1] - 1) if n else float("nan"),
            "cagr": float(v[-1] ** (12.0 / n) - 1) if n else float("nan"),
            "sharpe": float(r.mean() / sd * math.sqrt(12)) if sd and sd > 0 else float("nan"),
            "maxdd": float(dd), "months": n}


def top_windows(ls, lb, k=3, span=12):
    """贡献最大的 k 个互不重叠 12 个月窗口(按 log 超额)。返回起点下标列表。"""
    e = np.log1p(ls) - np.log1p(lb)
    n = len(e)
    sums = [(e[i:i + span].sum(), i) for i in range(0, n - span + 1)]
    taken, picks = np.zeros(n, bool), []
    for val, i in sorted(sums, reverse=True):
        if len(picks) == k:
            break
        if not taken[i:i + span].any():
            picks.append(i); taken[i:i + span] = True
    return sorted(picks), taken


def kill_gate(ls, lb, span=12):
    picks, taken = top_windows(ls, lb, span=span)
    keep = ~taken
    rs, rb = ls[keep], lb[keep]
    e = np.log1p(ls) - np.log1p(lb)
    simple = {"excess_pp": 100 * (np.prod(1 + rs) - np.prod(1 + rb)),
              "sharpe": stats(rs)["sharpe"], "baseline_sharpe": stats(rb)["sharpe"]}
    lr_s, lr_b = np.log1p(rs), np.log1p(rb)
    logv = {"log_excess_pp": 100 * float(e[keep].sum()),
            "sharpe_on_log": float(lr_s.mean() / lr_s.std(ddof=1) * math.sqrt(12)),
            "baseline_sharpe_on_log": float(lr_b.mean() / lr_b.std(ddof=1) * math.sqrt(12))}
    return {"windows": picks, "log_excess_in_windows_pp": [100 * float(e[i:i + span].sum()) for i in picks],
            "simple": simple, "log": logv}


# ---------------------------------------------------------------- 自检(合成数据)
def selftest():
    """在合成数据上验机制,不需要网。五项:
    1 恒等:所有基金走势相同 → 策略 = baseline - 成本
    2 埋信号:下月收益随本月折价加深而变好 → 策略跑赢
    3 前视陷阱:持有期收益只和"持有那个月折价的变化"相关 → 策略不许跑赢。
       折价是随机游走,变化量与执行时已知的水平无关;引擎若错用了下个月的折价
       (最常见的差一错位),这一项会假装大赚。
       注意:不能拿"同月折价水平"当陷阱 —— 随机游走下这个月的水平就是上个月的
       水平加一点噪声,诚实的引擎本来就该从里面赚到钱(第一版这么写,陷阱误报了)
    4 成本:换手 × 5bps 精确等于记账的成本
    5 baseline:等权 buy-hold 净值 = 各只增长倍数的均值,且中途不再平衡
    """
    rng = np.random.default_rng(7)
    days = pd.bdate_range("2011-01-03", "2014-12-31")
    tick = ["F%03d" % i for i in range(100)]
    months = pd.period_range("2011-01", "2014-12", freq="M")

    def make(kind):
        # 每只基金一个月一个折价(周频放在当月第 3 周),折价在 -20% ~ 0 之间
        d_rows, lvl = [], {t: rng.uniform(-20, 0) for t in tick}
        disc_by_m = {}
        for m in months:
            for t in tick:
                # 不截断:截在 [-25, 0] 会让贴边的基金变化有方向,陷阱就不干净了
                lvl[t] = float(lvl[t] + rng.normal(0, 3))
            disc_by_m[m] = dict(lvl)
            wk = pd.Timestamp(m.start_time) + pd.Timedelta(days=20)
            for t in tick:
                d_rows.append((wk, t, disc_by_m[m][t]))
        disc = pd.DataFrame(d_rows, columns=["date", "ticker", "discount"])
        # 日价:每个"持有期"(本月首个交易日 → 下月首个交易日)给一个收益,均匀摊到日上
        px = pd.DataFrame(100.0, index=days, columns=tick)
        first_day = {m: days[(days >= m.start_time) & (days <= m.end_time)][0] for m in months}
        for mi in range(len(months) - 1):
            m, m1 = months[mi], months[mi + 1]
            d0, d1 = first_day[m], first_day[m1]
            span_days = days[(days > d0) & (days <= d1)]
            for t in tick:
                if kind == "same":
                    R = 0.0
                elif kind == "planted":         # 上月末折价越深,这一期越好(信号在执行前已知)
                    R = -0.004 * disc_by_m[months[mi - 1]][t] if mi > 0 else 0.0
                elif kind == "peek":            # 只和持有这个月折价的"变化"相关:执行时不可知
                    prev = disc_by_m[months[mi - 1]][t] if mi > 0 else disc_by_m[m][t]
                    R = -0.02 * (disc_by_m[m][t] - prev)
                else:
                    R = rng.normal(0, 0.03)
                g = (1 + R) ** (1.0 / len(span_days))
                px.loc[span_days, t] = px.loc[d0, t] * np.cumprod([g] * len(span_days))
            after = days[days > d1]
            px.loc[after] = px.loc[d1].values
        return disc, px

    ok = True
    def check(cond, msg, extra=""):
        nonlocal ok
        print(("  ✓ " if cond else "  ✗ ") + msg + (("  (" + extra + ")") if extra else ""))
        ok &= bool(cond)

    kw = dict(universe=tick)
    import builtins
    global FIRST_SIGNAL, LAST_SIGNAL
    FIRST_SIGNAL, LAST_SIGNAL = "2011-02", "2014-10"

    disc, px = make("same")
    r = run(disc, px, **kw)
    s, b = stats(r["rets"]), stats(r["base"])
    cost_total = float(np.prod(1 - r["costs"]) - 1)
    check(abs(b["cumret"]) < 1e-9 and abs(s["cumret"] - cost_total) < 1e-9,
          "恒等:走势全同 → 策略只比 baseline 少掉成本", "策略 %.5f / 成本 %.5f" % (s["cumret"], cost_total))

    disc, px = make("planted")
    r = run(disc, px, **kw)
    s, b = stats(r["rets"]), stats(r["base"])
    check(s["cumret"] > b["cumret"] + 0.5, "埋信号:折价深 → 下期好,策略应明显跑赢",
          "策略 %+.1f%% / baseline %+.1f%%" % (100 * s["cumret"], 100 * b["cumret"]))

    disc, px = make("peek")
    r = run(disc, px, **kw)
    s, b = stats(r["rets"]), stats(r["base"])
    lookahead_gap = s["cumret"] - b["cumret"]
    check(abs(lookahead_gap) < 0.25, "前视陷阱:收益只跟持有月的折价变化相关 → 诚实引擎赚不到",
          "超额 %+.1f%%;故意错位一个月的引擎实测 +69.6%%" % (100 * lookahead_gap))

    disc, px = make("random")
    r = run(disc, px, **kw)
    check(np.allclose(r["costs"], COST * r["turnover"]), "成本 = 换手 × 5bps,逐期精确",
          "平均月换手 %.1f%%" % (100 * r["turnover"].mean()))
    check(r["turnover"][0] > 0.99 and r["turnover"][0] < 1.01, "第一期建仓换手 = 100%",
          "%.4f" % r["turnover"][0])

    exd = [px.index[(px.index >= (m + 1).start_time)][0] for m in r["months"]] + [None]
    d0 = px.index[(px.index >= (r["months"][0] + 1).start_time)][0]
    growth = px.loc[r["dates"][-1], tick] / px.loc[d0, tick]
    base_end = float(np.prod(1 + r["base"]))
    check(abs(base_end - growth.mean()) < 1e-9, "baseline 期末净值 = 各只增长倍数的均值(不再平衡)",
          "%.6f vs %.6f" % (base_end, growth.mean()))

    FIRST_SIGNAL, LAST_SIGNAL = "2011-12", "2026-07"
    print("\n自检" + ("全部通过" if ok else "有失败"))
    return ok


# ---------------------------------------------------------------- 主程序
def main():
    ap = argparse.ArgumentParser(description="CEF 折价五分位回测(按笔记规则重建)")
    ap.add_argument("--discounts"); ap.add_argument("--prices")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(0 if selftest() else 1)
    if not (a.discounts and a.prices):
        ap.error("需要 --discounts 和 --prices(格式见文件头),或者 --selftest")
    disc = pd.read_csv(a.discounts, parse_dates=["date"])
    pl = pd.read_csv(a.prices, parse_dates=["date"])
    px = pl.pivot_table(index="date", columns="ticker", values="adj_close").sort_index()

    out = {}
    r = run(disc, px, frac=0.2)
    s, b = stats(r["rets"]), stats(r["base"])
    out["universe_n"] = len(r["universe"])
    out["n_rebalance"] = len(r["rets"])
    out["主结果_扣成本"] = s
    out["baseline_EW_CEF"] = b
    out["excess_pp"] = 100 * (s["cumret"] - b["cumret"])
    out["平均月换手"] = float(r["turnover"].mean())
    gross = np.array([(1 + x) / (1 - c) - 1 for x, c in zip(r["rets"], r["costs"])])
    out["cost_drag_pp"] = 100 * (stats(gross)["cumret"] - s["cumret"])
    out["killgate_去三窗口"] = kill_gate(r["rets"], r["base"])
    for name, f in (("decile", 0.1), ("tercile", 1 / 3)):
        out["剂量反应_" + name] = stats(run(disc, px, frac=f, universe=r["universe"])["rets"])
    print(json.dumps(out, ensure_ascii=False, indent=1, default=float))
    print("\n对照 meta.json:cumret 5.4863 / Sharpe 0.9884;baseline cumret 1.9255;"
          "excess_pp 356.08;n_rebalance 176;cost_drag_pp 10.72")


if __name__ == "__main__":
    main()
