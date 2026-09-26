#!/usr/bin/env python3
"""独立复算：用纯 numpy（不同代码路径）重算主策略，并手工抽查 2008-10 转折点。"""
import pandas as pd, numpy as np, os
D = os.path.dirname(os.path.abspath(__file__))

df = pd.read_csv(f'{D}/results_monthly.csv', index_col=0)
# 注意 results_monthly.csv 存的是 excess net；total 版另存。这里复算 excess net 再与 main 列对比
legs = None
# 从原始数据重建 legs（独立于 backtest.py 的 load）
rows = []
for ln in open(f'{D}/data/F-F_Research_Data_Factors.csv').read().splitlines():
    s = ln.strip()
    if len(s) >= 6 and s[:6].isdigit() and (len(s) == 6 or s[6] in ', '):
        rows.append([float(x) for x in s.replace(' ', '').split(',')])
ff3 = pd.DataFrame(rows, columns=['ym', 'mktrf', 'smb', 'hml', 'rf'])
rows = []
for ln in open(f'{D}/data/F-F_Momentum_Factor.csv').read().splitlines():
    s = ln.strip()
    if len(s) >= 6 and s[:6].isdigit() and (len(s) == 6 or s[6] in ', '):
        rows.append([float(x) for x in s.replace(' ', '').split(',')])
mom = pd.DataFrame(rows, columns=['ym', 'umd'])
xl = pd.read_excel(f'{D}/data/BAB_monthly.xlsx', sheet_name='BAB Factors', header=None)
hdr = list(xl.iloc[18]); ui = hdr.index('USA'); d = xl.iloc[19:]
dts = pd.to_datetime(d.iloc[:, 0])
bab = pd.DataFrame({'ym': (dts.dt.year * 100 + dts.dt.month).values,
                    'bab': pd.to_numeric(d.iloc[:, ui], errors='coerce').values})
m = ff3.merge(mom, on='ym').merge(bab, on='ym').sort_values('ym').reset_index(drop=True)
m['rf'] = 0.0  # 统一口径：rf=0
R = np.column_stack([(m['mktrf'] / 100).values, (m['hml'] / 100).values,
                     (m['umd'] / 100).values, m['bab'].values])   # excess, 小数
REQ = R.mean(axis=1)
n = len(R); TV, VW, CB, CAP = 0.12, 6, 5e-4, 2.0

net2 = np.full(n, np.nan); w2 = np.full(n, np.nan)
wprev = np.zeros(4)
for t in range(VW, n):
    win = REQ[t - VW:t]
    sig = win.std(ddof=1) * np.sqrt(12)
    ws = TV / sig if sig > 1e-9 else 0.0
    g = 1.0 if REQ[t - 1] > 0 else 0.5
    wt = min(ws * g, CAP)
    wl = np.full(4, wt / 4)
    if t == VW:
        drift = np.zeros(4)
    else:
        rp = (wprev * R[t - 1]).sum()
        drift = wprev * (1 + R[t - 1]) / (1 + rp)
    to = np.abs(wl - drift).sum()
    net2[t] = (wl * R[t]).sum() - to * CB
    w2[t] = wt; wprev = wl

ref = df['main'].values
mask = ~np.isnan(ref)
dmax = np.abs(net2[mask] - ref[mask]).max()
print(f"独立复算: 最大逐月绝对偏差 = {dmax:.2e}  (months={mask.sum()})")
print("复算 cum(excess):", (1 + net2[mask]).prod() - 1)
print("原脚本 cum(excess):", (1 + ref[mask]).prod() - 1)

# ---- 手工抽查 2008-09 -> 2008-10 ----
ym = m['ym'].values
t = int(np.where(ym == 200810)[0][0])
print("\n--- 手工抽查 2008-10 ---")
print("r_eq[2008-09] =", REQ[t-1], "-> 门 =", 1.0 if REQ[t-1] > 0 else 0.5)
win = REQ[t-6:t]; sig = win.std(ddof=1)*np.sqrt(12)
print("6m 窗口:", ym[t-6], "->", ym[t-1], "年化 vol =", sig)
ws = 0.12/sig; print("w* =", ws, "cap 后 w =", min(ws*(1.0 if REQ[t-1]>0 else 0.5), 2.0))
print("脚本记录 w =", df['main'].values[t] and w2[t])
print("legs 2008-10 excess %:", (R[t]*100).round(2))
print("复算 net 2008-10 %:", round(net2[t]*100, 4))

# ---- Sharpe 公式抽查（合成小样本手算） ----
x = np.array([0.01, -0.02, 0.03]); rf0 = np.array([0.001, 0.001, 0.002])
hand = (x - rf0).mean() / x.std(ddof=1) * np.sqrt(12)
print("\nSharpe 手算抽查:", round(hand, 6))

# ---- 2010-2026 市场 Sharpe（total 口径） ----
tot = pd.read_csv(f'{D}/results_monthly_total.csv', index_col=0)
ym2 = m['ym'].values
mk = (m['mktrf']/100 + m['rf']/100).values
sel = (ym2 >= 201001) & (ym2 <= 202607)
ex = mk[sel] - (m['rf'].values[sel]/100)
print(f"2010-2026 市场 Sharpe = {ex.mean()/mk[sel].std(ddof=1)*np.sqrt(12):.3f}, "
      f"策略同期 Sharpe = {(tot['main'].values[sel]-m['rf'].values[sel]/100).mean()/tot['main'].values[sel].std(ddof=1)*np.sqrt(12):.3f}")
print(f"同期累计: 策略 {(1+tot['main'].values[sel]).prod()-1:.1%} vs 市场 {(1+mk[sel]).prod()-1:.1%}")
