"""
Backtest inspired by Zeiierman's "Volume Delta Footprint Map" (TradingView).

Faithful to the author's described methodology:
- Lower-timeframe delta: inside each 1H chart candle, sum signed 5m-candle volume
  (+volume for bullish 5m candles, -volume for bearish ones).
- Delta persistence: exponential decay via EMA of the hourly delta.
- Signal ("Find Trapped Buyers and Sellers" from the script's own docs):
  extreme delta + rejection at a swing high/low = trapped traders -> fade the move.

NOT a replication of the Pine Script (no price-stripe mapping, no visual overlay);
this tests whether the *concept* (LTF delta + absorption fade) has edge.
"""
import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ASSETS = ["NBIS", "NVDA", "SPY", "BTC-USD"]
NOTIONAL = 10_000
WARMUP = 60

# ---------------- data ----------------
def load(sym):
    df = yf.download(sym, period="60d", interval="5m", progress=False, auto_adjust=True)
    df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    return df.dropna(subset=["Open", "High", "Low", "Close"])

def to_hourly(df):
    df = df.copy()
    df["signed_vol"] = np.where(
        df["Close"] > df["Open"], df["Volume"],
        np.where(df["Close"] < df["Open"], -df["Volume"], 0.0))
    g = df.resample("1h")
    h = pd.DataFrame({
        "Open": g["Open"].first(), "High": g["High"].max(),
        "Low": g["Low"].min(), "Close": g["Close"].last(),
        "Volume": g["Volume"].sum(), "delta": g["signed_vol"].sum(),
    }).dropna()
    return h

# ---------------- strategy ----------------
def backtest(h):
    h = h.copy()
    h["delta_ema"] = h["delta"].ewm(span=6, adjust=False).mean()      # delta persistence (decay)
    h["z"] = ((h["delta_ema"] - h["delta_ema"].rolling(48).mean())
              / h["delta_ema"].rolling(48).std())                      # extreme pressure gauge
    pc = h["Close"].shift(1)
    tr = pd.concat([h["High"] - h["Low"], (h["High"] - pc).abs(),
                    (h["Low"] - pc).abs()], axis=1).max(axis=1)
    h["atr"] = tr.rolling(14).mean()
    h["swing_hi"] = h["High"].rolling(24).max()
    h["swing_lo"] = h["Low"].rolling(24).min()

    o = h["Open"].to_numpy(); hh = h["High"].to_numpy(); ll = h["Low"].to_numpy()
    c = h["Close"].to_numpy(); z = h["z"].to_numpy(); atr = h["atr"].to_numpy()
    shi = h["swing_hi"].to_numpy(); slo = h["swing_lo"].to_numpy()
    n = len(h)

    trades, equity = [], np.full(n, np.nan)
    pos, entry, eatr, held = 0, 0.0, 0.0, 0
    eq = NOTIONAL
    equity[:WARMUP] = NOTIONAL

    def long_setup(i):
        return z[i] < -1.25 and ll[i] <= slo[i] and c[i] > o[i]   # extreme selling, new low, rejection up
    def short_setup(i):
        return z[i] > 1.25 and hh[i] >= shi[i] and c[i] < o[i]    # extreme buying, new high, rejection down

    i = WARMUP
    while i < n - 1:
        if pos == 0:
            if long_setup(i):
                pos, entry, eatr, held = 1, o[i + 1], atr[i], 0
            elif short_setup(i):
                pos, entry, eatr, held = -1, o[i + 1], atr[i], 0
            equity[i] = eq
            i += 1
            continue
        # manage open position on bar i
        held += 1
        stop = entry - pos * 1.5 * eatr
        tgt = entry + pos * 3.0 * eatr
        exit_px, why = None, ""
        if pos == 1:
            if ll[i] <= stop: exit_px, why = stop, "stop"
            elif hh[i] >= tgt: exit_px, why = tgt, "target"
        else:
            if hh[i] >= stop: exit_px, why = stop, "stop"
            elif ll[i] <= tgt: exit_px, why = tgt, "target"
        if exit_px is None and (held >= 24 or (pos == 1 and short_setup(i)) or (pos == -1 and long_setup(i))):
            exit_px, why = c[i], "signal/timeout"
        if exit_px is not None:
            pnl = pos * (exit_px - entry) / entry * NOTIONAL
            eq += pnl
            trades.append({"dir": pos, "pnl": pnl, "ret": pnl / NOTIONAL, "why": why,
                           "t_in": h.index[i - held], "t_out": h.index[i]})
            pos = 0
        equity[i] = eq
        i += 1
    equity[n - 1] = eq
    eq_s = pd.Series(equity, index=h.index)
    return trades, eq_s

def metrics(trades, eq_s):
    if not trades:
        return {"n": 0}
    pnl = np.array([t["pnl"] for t in trades])
    wins = pnl[pnl > 0]; losses = pnl[pnl <= 0]
    dd = (eq_s / eq_s.cummax() - 1).min()
    return {
        "n": len(trades),
        "win_rate": round(len(wins) / len(trades) * 100, 1),
        "total_ret_%": round((eq_s.iloc[-1] / NOTIONAL - 1) * 100, 2),
        "avg_trade_%": round(pnl.mean() / NOTIONAL * 100, 2),
        "profit_factor": round(wins.sum() / abs(losses.sum()), 2) if losses.sum() else float("inf"),
        "max_dd_%": round(dd * 100, 2),
    }

# ---------------- run ----------------
results, curves = {}, {}
for sym in ASSETS:
    print(f"loading {sym} ...", flush=True)
    h = to_hourly(load(sym))
    trades, eq = backtest(h)
    m = metrics(trades, eq)
    bh = (h["Close"].iloc[-1] / h["Close"].iloc[WARMUP] - 1) * 100
    m["buy_hold_%"] = round(bh, 2)
    m["bars"] = len(h)
    results[sym] = m
    curves[sym] = (eq / NOTIONAL, h["Close"] / h["Close"].iloc[WARMUP])
    print(sym, m, flush=True)

pd.DataFrame(results).T.to_csv("/home/hatch/workspace/quant/delta_footprint_backtest/results.csv")

fig, axes = plt.subplots(2, 2, figsize=(12, 8), sharex=False)
for ax, sym in zip(axes.flat, ASSETS):
    strat, bh = curves[sym]
    ax.plot(strat.index, strat.values, label="delta-fade strategy")
    ax.plot(bh.index, bh.values, label="buy & hold", alpha=0.6, linestyle="--")
    ax.set_title(f"{sym}  (n={results[sym]['n']}, ret={results[sym]['total_ret_%']}%)")
    ax.legend(fontsize=8)
fig.suptitle("Volume-Delta absorption-fade backtest: equity (1.0 = start), 5m->1h, 60d")
fig.tight_layout()
fig.savefig("/home/hatch/workspace/your_files/delta_backtest_equity.png", dpi=110)
print("done")
