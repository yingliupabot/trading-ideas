"""Download 2y of hourly SPY bars (yfinance), save as CSV.
Run once; backtest.py reads local files only.

Note: Yahoo 只对 1m/5m 级别保留最近约 60 天数据，
2 年跨度下可用的最小日内级别是 60m。这里 chart 取日线、
LTF 取 60m（与 volume-delta-footprint v2 的映射一致）。
"""
import yfinance as yf
import pandas as pd
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data"
DATA.mkdir(exist_ok=True)

df = yf.download("SPY", period="2y", interval="1h", progress=False, auto_adjust=True)
if isinstance(df.columns, pd.MultiIndex):
    df.columns = [c[0] for c in df.columns]
df = df.dropna(subset=["Open", "High", "Low", "Close"])
out = DATA / "SPY_1h.csv"
df.to_csv(out)
size_mb = out.stat().st_size / 1e6
print(f"SPY: {len(df)} hourly bars, {df.index[0]} -> {df.index[-1]}, saved to {out} ({size_mb:.2f} MB)")
assert size_mb < 25, "file exceeds GitHub 25MB web-upload limit"
