"""Download 2y of hourly bars for GLD (author's XAUUSD -> spot gold proxy)
and SPY (baseline), save as CSV. Run once; backtest.py reads local files."""
import yfinance as yf
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data"
DATA.mkdir(exist_ok=True)

for sym in ["GLD", "SPY"]:
    df = yf.download(sym, period="2y", interval="1h", progress=False, auto_adjust=True)
    df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    out = DATA / f"{sym}_1h.csv"
    df.to_csv(out)
    print(f"{sym}: {len(df)} hourly bars, {df.index[0]} -> {df.index[-1]}, saved to {out}")
