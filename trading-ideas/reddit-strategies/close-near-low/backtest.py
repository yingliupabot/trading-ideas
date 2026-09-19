"""
Close-Near-Low 策略回测（来源：Reddit r/algotrading 帖子
"Backtesting a close near low strategy"，2021 年）。

原帖作者规则（long-only 日线均值回归）：
  1. 信号：RangePctClose = (Close - Low) / (High - Low) <= 0.2
     —— 收盘价落在当日交易区间底部 20% 以内。
  2. 进场：信号出现后下一个交易日开盘买入。
  3. 出场：进场后下一个交易日收盘卖出（持仓约 1 天）。

简化与假设（诚实记录）：
  - 原帖用 SPX 成分股池，这里先做单标的简化版：只用 SPY，验证信号本身。
  - 一次一笔、无杠杆、不做空；信号日之间不可能重叠（T 日信号 → T+1 开买、T+1 收卖，
    下一个最早进场日是 T+2 开），天然无仓位冲突。
  - 不计佣金/滑点/税费：这是未计成本版本，结论只说明"信号毛收益"。
  - Yahoo 调整后价格（auto_adjust=True），baseline 与策略口径一致（含分红）。
  - Baseline：同区间 SPY buy-and-hold（仓库 AGENT.md 规则）。

数据：data/SPY_daily.csv（yfinance SPY 日线，2020-01-01 → 2026-09-17）。
"""
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).parent
DATA = HERE / "data"
ASSETS = HERE / "assets"
DATA.mkdir(exist_ok=True)
ASSETS.mkdir(exist_ok=True)

TICKER = "SPY"
START = "2020-01-01"
END = "2026-09-18"          # yfinance end 不含当日 → 取到 2026-09-17
THRESHOLD = 0.20             # 原帖阈值


def download():
    df = yf.download(TICKER, start=START, end=END, auto_adjust=True,
                     progress=False, timeout=60)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    df.to_csv(DATA / "SPY_daily.csv")
    return df


def load():
    p = DATA / "SPY_daily.csv"
    if not p.exists():
        return download()
    return pd.read_csv(p, index_col=0, parse_dates=True)


def backtest(df):
    o, h, l, c = df["Open"], df["High"], df["Low"], df["Close"]
    rng = h - l
    # High == Low 的 doji 日：分母为 0 → 不给信号
    range_pct = np.where(rng > 0, (c - l) / rng, np.nan)
    signal = range_pct <= THRESHOLD

    trades = []  # (entry_date, exit_date, entry_px, exit_px, ret)
    n = len(df)
    for i in range(n - 2):
        if signal[i]:
            entry_px = float(o.iloc[i + 1])
            exit_px = float(c.iloc[i + 1])
            ret = exit_px / entry_px - 1.0
            trades.append((df.index[i + 1].date().isoformat(),
                           df.index[i + 1].date().isoformat(),
                           round(entry_px, 4), round(exit_px, 4),
                           round(ret, 6)))

    tr = pd.DataFrame(trades,
                      columns=["entry_date", "exit_date", "entry_px",
                               "exit_px", "ret"])
    tr.to_csv(HERE / "trades.csv", index=False)

    rets = tr["ret"].to_numpy()
    eq_mult = float(np.prod(1 + rets)) if len(rets) else 1.0
    total_ret = eq_mult - 1.0

    # 每日净值曲线（策略只在出场日跳变，其余时间持平）
    daily = df.copy()
    daily["strat_ret"] = 0.0
    if len(tr):
        exit_dates = pd.to_datetime(tr["exit_date"])
        ret_by_date = tr.set_index(exit_dates)["ret"]
        for d, r in ret_by_date.items():
            daily.loc[daily.index.date == d.date(), "strat_ret"] = r
    daily["strat_eq"] = (1 + daily["strat_ret"]).cumprod()
    daily["bh_eq"] = c / c.iloc[0]

    # 最大回撤（策略净值）
    roll_max = daily["strat_eq"].cummax()
    max_dd = float(((daily["strat_eq"] - roll_max) / roll_max).min())

    wins = rets[rets > 0]
    losses = rets[rets < 0]
    res = {
        "period": f"{df.index[0].date()} -> {df.index[-1].date()}",
        "bars": int(n),
        "n_trades": int(len(tr)),
        "win_rate_%": round(100 * (rets > 0).mean(), 2) if len(rets) else 0.0,
        "avg_trade_%": round(100 * rets.mean(), 4) if len(rets) else 0.0,
        "profit_factor": round(wins.sum() / abs(losses.sum()), 3)
            if len(wins) and len(losses) else (float("inf") if len(wins) else 0.0),
        "strategy_ret_%": round(100 * total_ret, 2),
        "buy_hold_SPY_%": round(100 * (c.iloc[-1] / c.iloc[0] - 1), 2),
        "excess_vs_SPY_%": round(100 * (total_ret - (c.iloc[-1] / c.iloc[0] - 1)), 2),
        "max_dd_%": round(100 * max_dd, 2),
    }
    pd.DataFrame([{k: v for k, v in res.items()}]).to_csv(
        HERE / "results.csv", index=False)
    return daily, res


def plot(daily, res):
    fig, ax = plt.subplots(figsize=(10, 5.5))
    ax.plot(daily.index, daily["strat_eq"], label="Close-Near-Low strategy", lw=1.6)
    ax.plot(daily.index, daily["bh_eq"], label="SPY buy-and-hold",
            lw=1.2, ls="--", alpha=0.8)
    ax.set_title("Close-Near-Low (gross, no costs) vs SPY buy-and-hold")
    ax.set_ylabel("Equity (start=1)")
    ax.grid(alpha=0.3)
    ax.legend()
    txt = (f"strategy {res['strategy_ret_%']}% | SPY {res['buy_hold_SPY_%']}% | "
           f"excess {res['excess_vs_SPY_%']}% | {res['n_trades']} trades | "
           f"win rate {res['win_rate_%']}% | max DD {res['max_dd_%']}%")
    fig.text(0.5, 0.01, txt, ha="center", fontsize=9)
    fig.tight_layout(rect=[0, 0.04, 1, 1])
    fig.savefig(ASSETS / "equity.png", dpi=110)
    plt.close(fig)


if __name__ == "__main__":
    df = load()
    daily, res = backtest(df)
    plot(daily, res)
    for k, v in res.items():
        print(f"{k}: {v}")
    print(f"\n已保存: results.csv, trades.csv, assets/equity.png, "
          f"data/SPY_daily.csv")
