"""
Backtest v2 — faithful to Zeiierman's "Volume Delta Footprint Map" (TradingView).

Author's setup, mirrored here:
- Asset: author's demos are XAUUSD / BCOUSD / NAS100USD (OANDA CFDs).
  We use GLD (spot-gold tracker, no futures rolls) as the XAUUSD proxy.
- Chart timeframe: 1D -> author's auto lower-timeframe mapping selects 60m
  as the LTF for daily charts. Delta inside each daily bar = sum of signed
  hourly volume (bullish hour +, bearish hour -), exactly the author's
  "bullish candles contribute positive volume, bearish negative" rule.
- Delta persistence: EMA(span=12) on daily delta (author default life=12).
- "Strong" gate: normalized strength = |delta_ema| / rolling(120).max >= 0.12
  (author default minS=0.12), plus extreme z-score |z| >= 1.5.
- Signal ("Find Trapped Buyers and Sellers" from the script's own docs):
  strong positive delta + rejection at 20d swing high -> SHORT (fade trapped buyers)
  strong negative delta + rejection at 20d swing low  -> LONG  (fade trapped sellers)
- Risk: 1.5x ATR(14) stop, 3x ATR target, max 10 trading days hold.
- Baseline: buy-and-hold SPY over the exact same dates (AGENT.md rule).

Approximations (honest): delta is estimated from hourly candle direction,
NOT exchange bid/ask ticks (the author is upfront about this too). No fees /
slippage modeled. One position at a time, full notional, no leverage.

Data: data/GLD_1h.csv + data/SPY_1h.csv (yfinance, 2y hourly, saved to disk).
"""
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data"
NOTIONAL = 10_000
WARMUP = 120          # author's lookback default
MAX_HOLD = 10        # trading days
SWING = 20

# ---------------- data ----------------
def load_1h(sym):
    df = pd.read_csv(DATA / f"{sym}_1h.csv", index_col=0, parse_dates=True)
    # normalize to ET date for daily resampling
    df.index = pd.to_datetime(df.index, utc=True).tz_convert("America/New_York")
    return df

def to_daily(df):
    df = df.copy()
    df["signed_vol"] = np.where(
        df["Close"] > df["Open"], df["Volume"],
        np.where(df["Close"] < df["Open"], -df["Volume"], 0.0))
    g = df.resample("1D")
    d = pd.DataFrame({
        "Open": g["Open"].first(), "High": g["High"].max(),
        "Low": g["Low"].min(), "Close": g["Close"].last(),
        "Volume": g["Volume"].sum(), "delta": g["signed_vol"].sum(),
    }).dropna()
    return d

def add_features(d):
    d = d.copy()
    d["delta_ema"] = d["delta"].ewm(span=12, adjust=False).mean()   # author life=12
    roll = d["delta_ema"].rolling(WARMUP)
    d["strength"] = d["delta_ema"].abs() / roll.max().replace(0, np.nan)  # author minS=0.12
    d["z"] = (d["delta_ema"] - roll.mean()) / roll.std()
    pc = d["Close"].shift(1)
    tr = pd.concat([d["High"] - d["Low"], (d["High"] - pc).abs(),
                    (d["Low"] - pc).abs()], axis=1).max(axis=1)
    d["atr"] = tr.rolling(14).mean()
    d["swing_hi"] = d["High"].rolling(SWING).max().shift(1)  # exclude today: no lookahead
    d["swing_lo"] = d["Low"].rolling(SWING).min().shift(1)
    return d.dropna()

# ---------------- strategy ----------------
def backtest(d):
    o = d["Open"].to_numpy(); hh = d["High"].to_numpy(); ll = d["Low"].to_numpy()
    c = d["Close"].to_numpy(); z = d["z"].to_numpy(); st = d["strength"].to_numpy()
    atr = d["atr"].to_numpy(); shi = d["swing_hi"].to_numpy(); slo = d["swing_lo"].to_numpy()
    n = len(d)
    eq = np.full(n, np.nan); trades = []
    cur = NOTIONAL
    i = WARMUP
    while i < n - 1:
        strong = st[i] >= 0.12   # author's minS default; z-score kept for reporting only
        rng = hh[i] - ll[i]
        long_sig = strong and z[i] < 0 and ll[i] <= slo[i] and rng > 0 and (c[i] - ll[i]) / rng >= 0.5
        short_sig = strong and z[i] > 0 and hh[i] >= shi[i] and rng > 0 and (hh[i] - c[i]) / rng >= 0.5
        if not (long_sig or short_sig):
            i += 1; continue   # flat days stay NaN -> ffilled later
        side = 1 if long_sig else -1
        entry = c[i]; a = atr[i]
        stop = entry - side * 1.5 * a; target = entry + side * 3.0 * a
        exit_px, exit_i = c[min(i + MAX_HOLD, n - 1)], min(i + MAX_HOLD, n - 1)
        for j in range(i + 1, min(i + MAX_HOLD + 1, n)):
            if side == 1:
                if ll[j] <= stop: exit_px, exit_i = stop, j; break
                if hh[j] >= target: exit_px, exit_i = target, j; break
            else:
                if hh[j] >= stop: exit_px, exit_i = stop, j; break
                if ll[j] <= target: exit_px, exit_i = target, j; break
            exit_px, exit_i = c[j], j
        ret = side * (exit_px - entry) / entry
        trades.append(ret)
        cur = cur * (1 + ret)
        eq[i:exit_i + 1] = cur   # mark holding window at exit equity
        i = exit_i + 1
    eq = pd.Series(eq, index=d.index).ffill().fillna(NOTIONAL)
    rets = np.array(trades)
    wins = rets[rets > 0]
    return {
        "n": len(rets),
        "win_rate": 100 * (rets > 0).mean() if len(rets) else 0,
        "total_ret_%": 100 * (eq.iloc[-1] / NOTIONAL - 1),
        "avg_trade_%": 100 * rets.mean() if len(rets) else 0,
        "profit_factor": wins.sum() / abs(rets[rets < 0].sum()) if (rets < 0).any() and wins.size else float("inf"),
        "max_dd_%": 100 * ((eq / eq.cummax() - 1).min()),
        "bars": n,
    }, eq

def buy_hold(d):
    return 100 * (d["Close"].iloc[-1] / d["Close"].iloc[0] - 1)

# ---------------- run ----------------
# ---------------- run ----------------
def main():
    gld = add_features(to_daily(load_1h("GLD")))
    spy = to_daily(load_1h("SPY")).loc[gld.index[0]:gld.index[-1]]

    res, eq = backtest(gld)
    res["buy_hold_SPY_%"] = round(buy_hold(spy), 2)
    res["buy_hold_GLD_%"] = round(buy_hold(gld), 2)
    res["excess_vs_SPY_%"] = round(res["total_ret_%"] - res["buy_hold_SPY_%"], 2)
    res["period"] = f"{gld.index[0].date()} -> {gld.index[-1].date()}"

    print(pd.DataFrame([res]).T)

    pd.DataFrame([{k: (round(v, 2) if isinstance(v, float) else v) for k, v in res.items()}]) \
        .to_csv(HERE / "results.csv", index=False)

    # equity plot: strategy vs SPY buy-hold (rebased)
    spy_eq = NOTIONAL * spy["Close"] / spy["Close"].iloc[0]
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(eq.index, eq.values, label="Delta-fade strategy (GLD)")
    ax.plot(spy_eq.index, spy_eq.values, label="Buy-hold SPY (baseline)", linestyle="--")
    ax.set_title("Volume Delta Footprint v2 — strategy vs SPY baseline")
    ax.set_ylabel("Equity ($)")
    ax.legend(); ax.grid(alpha=0.3); fig.tight_layout()
    (HERE / "assets").mkdir(exist_ok=True)
    fig.savefig(HERE / "assets" / "equity.png", dpi=100)
    print("saved results.csv + assets/equity.png")

if __name__ == "__main__":
    main()
