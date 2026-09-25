#!/usr/bin/env python3
"""p11-btc-mvrv: BTC MVRV market-timing backtest.
Data: Coin Metrics free community archive (github.com/coinmetrics/data), btc.csv,
      CapMVRVCur (MVRV) + PriceUSD, daily.
Rules (spec):
  daily MVRV > 3.7 -> exit to cash; MVRV < 1 -> full buy BTC;
  1~3.7 -> keep prior state (hysteresis). Initial state: holding BTC (noted assumption).
  Execution at signal-day close (PriceUSD reference price).
Costs: 5bps one-way on full-portfolio switches.
Baseline: BTC buy-and-hold over same sample, no costs.
"""
import csv, json, math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

OUT = '/home/hatch/workspace/trading-ideas/sweeps/marathon/p11-btc-mvrv'

rows = [r for r in csv.DictReader(open('/tmp/cm_btc.csv'))
        if r['time'] >= '2015-01-01' and r['CapMVRVCur'] and r['PriceUSD']]
dates = [r['time'] for r in rows]
px = [float(r['PriceUSD']) for r in rows]
mv = [float(r['CapMVRVCur']) for r in rows]
n = len(rows)
print('sample:', dates[0], '->', dates[-1], 'n=', n)

FEE = 0.0005
pos = 1  # 1 = BTC, 0 = cash; initial: holding BTC (assumption)
val = 1.0  # portfolio value in USD, normalized start = 1
trades = []  # (date, side, price, mvrv)
eq = []
# track BTC units (clean implementation)
units = 1.0 / px[0]  # start fully in BTC, 1 USD notional
cash = 0.0
in_btc = True
for i in range(n):
    v = mv[i]
    if in_btc and v > 3.7:
        cash = units * px[i] * (1 - FEE); units = 0.0; in_btc = False
        trades.append((dates[i], 'EXIT', px[i], v))
    elif (not in_btc) and v < 1.0:
        units = cash / px[i] * (1 - FEE); cash = 0.0; in_btc = True
        trades.append((dates[i], 'ENTRY', px[i], v))
    eq.append(units * px[i] + cash)

# baseline: buy-hold from day-1 close
base = [px[i] / px[0] for i in range(n)]

def cagr_mult(curve):
    return curve[-1]

def sharpe(curve, annual=365):
    import statistics
    rets = [math.log(curve[i] / curve[i-1]) for i in range(1, len(curve))]
    m = statistics.mean(rets); s = statistics.stdev(rets)
    return (m / s) * math.sqrt(annual) if s > 0 else 0.0

def maxdd(curve):
    peak = curve[0]; mdd = 0.0
    for v in curve:
        peak = max(peak, v); mdd = min(mdd, v / peak - 1)
    return mdd

s_ret = (eq[-1] / eq[0] - 1) * 100
b_ret = (base[-1] - 1) * 100
excess = s_ret - b_ret
s_sh = sharpe(eq); b_sh = sharpe(base)
s_dd = maxdd(eq) * 100; b_dd = maxdd(base) * 100

res = {
    'sample': f"{dates[0]}->{dates[-1]}",
    'n_days': n,
    'strategy_ret_pct': round(s_ret, 2),
    'baseline_ret_pct': round(b_ret, 2),
    'excess_pp': round(excess, 2),
    'sharpe': round(s_sh, 3),
    'baseline_sharpe': round(b_sh, 3),
    'trades': len(trades),
    'max_dd_pct': round(s_dd, 2),
    'baseline_max_dd_pct': round(b_dd, 2),
    'trade_log': [{'date': t[0], 'side': t[1], 'price': round(t[2], 2), 'mvrv': round(t[3], 4)} for t in trades],
}
print(json.dumps(res, indent=2, ensure_ascii=False))
json.dump(res, open(f'{OUT}/results.json', 'w'), indent=2, ensure_ascii=False)

# charts
import matplotlib.dates as mdates
from datetime import datetime
dts = [datetime.strptime(d, '%Y-%m-%d') for d in dates]
fig, ax = plt.subplots(2, 1, figsize=(11, 8), sharex=True, gridspec_kw={'height_ratios': [3, 2]})
ax[0].plot(dts, eq, label='MVRV strategy (net of 5bps)', lw=1.5)
ax[0].plot(dts, base, label='BTC buy-hold', lw=1.5, alpha=0.8)
for t in trades:
    d = datetime.strptime(t[0], '%Y-%m-%d')
    ax[0].axvline(d, color='red' if t[1] == 'EXIT' else 'green', ls='--', alpha=0.6, lw=1)
ax[0].set_yscale('log'); ax[0].set_ylabel('Growth of $1 (log)')
ax[0].legend(); ax[0].set_title('BTC MVRV timing vs buy-hold (2015-01-01 -> 2026-05-23)')
ax[0].grid(True, alpha=0.3)
ax[1].plot(dts, mv, lw=1, color='purple')
ax[1].axhline(3.7, color='red', ls='--', lw=1, label='exit > 3.7')
ax[1].axhline(1.0, color='green', ls='--', lw=1, label='entry < 1')
ax[1].set_ylabel('MVRV'); ax[1].legend(); ax[1].grid(True, alpha=0.3)
ax[1].xaxis.set_major_locator(mdates.YearLocator())
fig.tight_layout(); fig.savefig(f'{OUT}/assets/equity.png', dpi=110)
print('charts saved')
