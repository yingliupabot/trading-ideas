#!/usr/bin/env python3
"""
r2-conditional-volmanage: 条件式多因子 volatility management（自研，无直接文献）
================================================================================
规则（按任务书实现）:
  因子池: MKT-RF + HML + UMD(动量) + BAB, 全部为月频 excess return（小数单位）
  原组合: 四因子等权 r_eq = mean(4 legs)
  Moreira-Muir 逆方差缩放: 月末按过去 6 个月（126 交易日的月频对应口径）组合
      realized vol 缩放, 目标 vol = 12% 年化, 全文统一；
      权重上限 2.0x（可实施性选择，如实披露；无上限版见注记）
  条件门（自研核心）: 若组合过去 1 个月收益 > 0 -> 全缩放权重;
      若 <= 0（下跌/高 vol 代理）-> 0.5x 缩放后权重
  月调仓；单边 5bps 按换手率计入
口径: 全部序列转为 total return（自融资组合按全抵押 +rf），Sharpe = mean(total-rf)/std * sqrt(12)；
      全样本对比统一用策略可交易窗口 1931-07->2026-07
Baseline: (1) 朴素 MM 只缩市场因子 (2) 未缩放原四因子组合 (3) 市场 buy-hold
  （French MKT 全历史；SPY 1993+ 另列）
"""
import pandas as pd, numpy as np, json, os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

D = os.path.dirname(os.path.abspath(__file__))
TARGET_VOL = 0.12
VOL_WIN = 6
COST_BPS = 5e-4
W_CAP = 2.0

# ---------------- 数据 ----------------
def load():
    rows = []
    for ln in open(f'{D}/data/F-F_Research_Data_Factors.csv').read().splitlines():
        s = ln.strip()
        if len(s) >= 6 and s[:6].isdigit() and (len(s) == 6 or s[6] in ', '):
            rows.append(s)
    ff3 = pd.DataFrame([r.replace(' ', '').split(',') for r in rows],
                       columns=['ym', 'mktrf', 'smb', 'hml', 'rf'])
    ff3 = ff3.astype(float); ff3['ym'] = ff3['ym'].astype(int)
    rows = []
    for ln in open(f'{D}/data/F-F_Momentum_Factor.csv').read().splitlines():
        s = ln.strip()
        if len(s) >= 6 and s[:6].isdigit() and (len(s) == 6 or s[6] in ', '):
            rows.append(s)
    mom = pd.DataFrame([r.replace(' ', '').split(',') for r in rows],
                       columns=['ym', 'umd'])
    mom = mom.astype(float); mom['ym'] = mom['ym'].astype(int)
    xl = pd.read_excel(f'{D}/data/BAB_monthly.xlsx', sheet_name='BAB Factors', header=None)
    hdr = list(xl.iloc[18]); ui = hdr.index('USA')
    d = xl.iloc[19:].copy()
    dts = pd.to_datetime(d.iloc[:, 0])
    bab = pd.DataFrame({'ym': (dts.dt.year * 100 + dts.dt.month).values,
                        'bab': pd.to_numeric(d.iloc[:, ui], errors='coerce').values})
    spy = pd.read_csv(f'{D}/data/spy_monthly.csv', index_col=0)
    spy.index = pd.PeriodIndex(spy.index, freq='M')
    spydf = pd.DataFrame({'ym': (spy.index.year * 100 + spy.index.month).values,
                          'spy': spy.iloc[:, 0].values})
    df = ff3.merge(mom, on='ym', how='inner').merge(bab, on='ym', how='inner')
    df = df.sort_values('ym').reset_index(drop=True)
    for c in ['mktrf', 'smb', 'hml', 'rf', 'umd']:
        df[c] = df[c] / 100.0
    df['mkt_total'] = df['mktrf'] + df['rf']
    df = df.merge(spydf, on='ym', how='left')
    df['date'] = pd.to_datetime(df['ym'].astype(str), format='%Y%m')
    return df

# ---------------- 回测引擎 ----------------
def run(legs_ret, gate_fn):
    """legs_ret: leg excess returns. 月末 t 用 t-6..t-1 信息定权重, 作用于 t 月.
       返回 DataFrame(net=扣成本后 excess, w, turnover, cost), index 对齐."""
    n = len(legs_ret); idx = legs_ret.index
    r_eq = legs_ret.mean(axis=1)
    net = pd.Series(np.nan, index=idx)
    w_hist, to_hist, cost_hist = [], [], []
    w_prev = pd.Series(0.0, index=legs_ret.columns)
    for t in range(VOL_WIN, n):
        win = r_eq.iloc[t - VOL_WIN:t]          # 不含 t, 无前视
        sig = win.std(ddof=1) * np.sqrt(12)
        w_star = TARGET_VOL / sig if sig > 1e-9 else 0.0
        g = gate_fn(t, legs_ret, r_eq)          # 门用 t-1 及更早信息
        w_t = min(w_star * g, W_CAP)
        w_leg = pd.Series(w_t / len(legs_ret.columns), index=legs_ret.columns)
        if t == VOL_WIN:
            drift = pd.Series(0.0, index=legs_ret.columns)   # 首月建仓
        else:
            r_prev = legs_ret.iloc[t - 1]
            rp_prev = (w_prev * r_prev).sum()
            drift = w_prev * (1 + r_prev) / (1 + rp_prev)
        turnover = (w_leg - drift).abs().sum()
        cost = turnover * COST_BPS
        net.iloc[t] = (w_leg * legs_ret.iloc[t]).sum() - cost
        w_hist.append(w_t); to_hist.append(turnover); cost_hist.append(cost)
        w_prev = w_leg
    out = pd.DataFrame({'net': net}, index=idx)
    out['w'] = pd.Series(w_hist, index=idx[VOL_WIN:])
    out['turnover'] = pd.Series(to_hist, index=idx[VOL_WIN:])
    out['cost'] = pd.Series(cost_hist, index=idx[VOL_WIN:])
    return out

# ---------------- 门函数 ----------------
def gate_1m(t, legs, r_eq):      return 1.0 if r_eq.iloc[t - 1] > 0 else 0.5
def gate_none(t, legs, r_eq):    return 1.0
def gate_reverse(t, legs, r_eq): return 1.0 if r_eq.iloc[t - 1] <= 0 else 0.5
def gate_3m(t, legs, r_eq):      return 1.0 if r_eq.iloc[t - 3:t].sum() > 0 else 0.5
def make_gate_volquantile(r_eq):
    vol12 = r_eq.rolling(12).std(ddof=1) * np.sqrt(12)
    def g(t, legs, r_eq_):
        hist = vol12.iloc[:t].dropna()
        if len(hist) < 36 or pd.isna(vol12.iloc[t - 1]):
            return 1.0
        return 1.0 if vol12.iloc[t - 1] <= hist.median() else 0.5
    return g

# ---------------- 指标 ----------------
def metrics(r_total, rf):
    r_total = r_total.dropna(); rf = rf.loc[r_total.index]
    if len(r_total) == 0: return {}
    cum = float((1 + r_total).prod() - 1)
    ann = float((1 + r_total).prod() ** (12 / len(r_total)) - 1)
    ex = r_total - rf
    sharpe = float(ex.mean() / r_total.std(ddof=1) * np.sqrt(12)) if r_total.std() > 0 else 0.0
    dd = float(((1 + r_total).cumprod() / (1 + r_total).cumprod().cummax() - 1).min())
    return dict(n=len(r_total), cumret=cum, annret=ann, sharpe=sharpe, maxdd=dd)

def main():
    df = load()
    print(f"原始样本: {df.ym.min()} -> {df.ym.max()}, n={len(df)}")
    print("因子月均%/std%: " + ", ".join(
        f"{c}={df[c].mean()*100:.2f}/{df[c].std()*100:.2f}" for c in ['mktrf', 'hml', 'umd', 'bab']))
    legs4, legs3 = df[['mktrf', 'hml', 'umd', 'bab']].copy(), df[['mktrf', 'hml', 'umd']].copy()
    mkt_only = df[['mktrf']].copy()
    res = {
        'main':    run(legs4, gate_1m),
        'nogate':  run(legs4, gate_none),
        'reverse': run(legs4, gate_reverse),
        'gate3m':  run(legs4, gate_3m),
        'gatevolq': run(legs4, make_gate_volquantile(legs4.mean(axis=1))),
        'nobab':   run(legs3, gate_1m),
        'mm_mkt':  run(mkt_only, gate_none),
    }
    rets = pd.DataFrame(index=df.index)
    for k, v in res.items(): rets[k] = v['net']
    rets['unscaled'] = legs4.mean(axis=1)
    rets['mkt'] = df['mkt_total']; rets['spy'] = df['spy']
    rets.to_csv(f'{D}/results_monthly.csv')

    rf = df['rf']
    tot = rets.copy()
    for k in ['main', 'nogate', 'reverse', 'gate3m', 'gatevolq', 'nobab', 'mm_mkt', 'unscaled']:
        tot[k] = rets[k] + rf          # 全抵押假设转 total return
    tot.to_csv(f'{D}/results_monthly_total.csv')

    span = tot['main'].dropna().index   # 统一评估窗口 1931-07->2026-07
    print(f"评估窗口: {df.ym.loc[span].min()} -> {df.ym.loc[span].max()}, n={len(span)}")

    keys = ['main', 'nogate', 'reverse', 'gate3m', 'gatevolq', 'nobab', 'mm_mkt', 'unscaled', 'mkt']
    rows = []
    for k in keys:
        m = metrics(tot.loc[span, k], rf.loc[span]); m['key'] = k; rows.append(m)
    m = metrics(tot['spy'].dropna(), rf.loc[tot['spy'].dropna().index]); m['key'] = 'spy_1993p'; rows.append(m)
    summ = pd.DataFrame(rows).set_index('key')
    summ.to_csv(f'{D}/summary_metrics.csv')

    sm = summ.loc['main']
    print("\n===== 主策略 vs Baselines（全样本，扣成本，total-return 口径） =====")
    verdicts = {}
    for b in ['mm_mkt', 'unscaled', 'mkt']:
        bm = summ.loc[b]
        exc = (sm.cumret - bm.cumret) * 100
        ok = (sm.cumret > bm.cumret) and (sm.sharpe > bm.sharpe) and (exc >= 10)
        verdicts[b] = ok
        print(f"vs {b:9s}: 策略 cum {sm.cumret*100:9.1f}% | base {bm.cumret*100:9.1f}% "
              f"| 超额 {exc:+9.1f}pp | Sharpe {sm.sharpe:.3f} vs {bm.sharpe:.3f} | {'PASS' if ok else 'FAIL'}")
    print(f"主策略: 交易月数={int(sm['n'])}（=调仓次数；腿调整={int(sm['n'])}x4), "
          f"最大回撤={sm.maxdd*100:.1f}%, 平均换手={res['main']['turnover'].mean()*100:.1f}%/月, "
          f"权重均值/最大={res['main']['w'].mean():.2f}/{res['main']['w'].max():.2f}, "
          f"成本拖累≈{res['main']['cost'].sum()*100:.1f}pp累计")
    ms = metrics(tot.loc[tot['spy'].notna(), 'main'], rf.loc[tot['spy'].notna()])
    ss = summ.loc['spy_1993p']
    print(f"SPY 窗口对照(1993-02->2026-07): 策略 cum {ms['cumret']*100:.1f}% Sh {ms['sharpe']:.3f} | "
          f"SPY cum {ss['cumret']*100:.1f}% Sh {ss['sharpe']:.3f}")

    print("\n===== 条件门三向对比（扣成本） =====")
    for k in ['main', 'nogate', 'reverse']:
        m = summ.loc[k]
        print(f"{k:8s}: cum {m.cumret*100:9.1f}% | Sharpe {m.sharpe:.3f} | maxDD {m.maxdd*100:6.1f}%")
    print("===== 门定义稳健性 =====")
    for k in ['main', 'gate3m', 'gatevolq', 'nogate']:
        m = summ.loc[k]
        print(f"{k:8s}: cum {m.cumret*100:9.1f}% | Sharpe {m.sharpe:.3f}")

    print("\n===== 分样本 =====")
    sub_rows = []
    for name, a, b in [('1931-1989', 193107, 198912), ('1990-2009', 199001, 200912), ('2010-2026', 201001, 202607)]:
        mask = (df['ym'] >= a) & (df['ym'] <= b)
        line = {'period': name}
        for k in ['main', 'nogate', 'reverse', 'mm_mkt', 'unscaled', 'mkt']:
            m = metrics(tot.loc[mask, k], rf.loc[mask])
            line[f'{k}_cum'] = m['cumret'] * 100; line[f'{k}_sharpe'] = m['sharpe']; line[f'{k}_dd'] = m['maxdd'] * 100
        line['exc_vs_unscaled'] = line['main_cum'] - line['unscaled_cum']
        line['exc_vs_mkt'] = line['main_cum'] - line['mkt_cum']
        line['exc_vs_mmmkt'] = line['main_cum'] - line['mm_mkt_cum']
        sub_rows.append(line)
        print(f"[{name}] main {line['main_cum']:8.1f}%/{line['main_sharpe']:.2f}/DD{line['main_dd']:.1f}% | "
              f"nogate {line['nogate_cum']:8.1f}%/{line['nogate_sharpe']:.2f} | "
              f"reverse {line['reverse_cum']:8.1f}%/{line['reverse_sharpe']:.2f} | "
              f"超额:未缩放{line['exc_vs_unscaled']:+.1f}pp 市场{line['exc_vs_mkt']:+.1f}pp 朴素MM{line['exc_vs_mmmkt']:+.1f}pp")
    pd.DataFrame(sub_rows).to_csv(f'{D}/subsamples.csv', index=False)

    nm = summ.loc['nobab']
    print(f"\n===== 去 BAB（3 因子主门）: cum {nm.cumret*100:.1f}% Sharpe {nm.sharpe:.3f} "
          f"| 4 因子主策略 cum {sm.cumret*100:.1f}% Sharpe {sm.sharpe:.3f}")
    plot(tot, df, span)
    meta = dict(target_vol=TARGET_VOL, vol_window_m=VOL_WIN, w_cap=W_CAP, cost_bps_oneway=5,
                eval_window=f"{int(df.ym.loc[span].min())}->{int(df.ym.loc[span].max())}",
                convention="total return; self-financing legs fully collateralized (+rf); Sharpe on total-rf",
                bab="AQR Betting Against Beta Equity Factors Monthly, USA sheet, self-financing excess returns, decimal units",
                french="Ken French Data Library F-F_Research_Data_Factors_CSV + F-F_Momentum_Factor_CSV, 202607 CRSP vintage",
                spy="Yahoo Finance SPY adj close total return, 1993-02->2026-08")
    json.dump(meta, open(f'{D}/meta.json', 'w'), indent=2, ensure_ascii=False)
    print("\n产物已写:", D)

def plot(tot, df, span):
    eq = (1 + tot.loc[span, ['main', 'nogate', 'reverse', 'mm_mkt', 'unscaled', 'mkt']]).cumprod()
    fig, ax = plt.subplots(figsize=(11, 6))
    for c in eq.columns:
        ax.plot(df['date'].loc[eq.index], eq[c], label=c, lw=1.8 if c == 'main' else 1.0,
                alpha=1.0 if c == 'main' else 0.7)
    ax.set_yscale('log'); ax.set_title('$1 growth, log scale, net of 5bps one-way (total return)')
    ax.legend(fontsize=8, loc='upper left'); ax.grid(alpha=0.3); fig.tight_layout()
    fig.savefig(f'{D}/assets/equity.png', dpi=120); plt.close(fig)
    subs = pd.read_csv(f'{D}/subsamples.csv')
    fig, axes = plt.subplots(1, 3, figsize=(12, 4))
    for ax, col, ttl in zip(axes, ['exc_vs_unscaled', 'exc_vs_mkt', 'exc_vs_mmmkt'],
                            ['excess vs unscaled (pp)', 'excess vs market (pp)', 'excess vs naive MM-mkt (pp)']):
        ax.bar(subs['period'], subs[col], color=['#2ca02c' if v > 0 else '#d62728' for v in subs[col]])
        ax.axhline(0, color='k', lw=0.8); ax.set_title(ttl); ax.grid(alpha=0.3, axis='y')
    fig.suptitle('Main strategy excess return by subperiod (cumulative pp, net)')
    fig.tight_layout(); fig.savefig(f'{D}/assets/subsamples.png', dpi=120); plt.close(fig)
    keys = ['main', 'gate3m', 'gatevolq', 'nogate', 'reverse']
    s = pd.read_csv(f'{D}/summary_metrics.csv', index_col=0)
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    axes[0].bar(keys, [s.loc[k, 'sharpe'] for k in keys]); axes[0].set_title('Sharpe by gate definition'); axes[0].grid(alpha=0.3, axis='y')
    axes[1].bar(keys, [s.loc[k, 'cumret'] * 100 for k in keys]); axes[1].set_title('Cumulative % by gate definition'); axes[1].grid(alpha=0.3, axis='y')
    fig.suptitle('Gate robustness (net of costs)'); fig.tight_layout()
    fig.savefig(f'{D}/assets/gate_ablation.png', dpi=120); plt.close(fig)

if __name__ == '__main__':
    main()
