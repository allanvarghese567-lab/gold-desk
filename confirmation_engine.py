#!/usr/bin/env python3
"""
Confirmation Engine
===================
Turns the "extra evidence before acting on a signal" list into code.

1. Every confirmation is a SHORT CODE like P_CLOSE or V_SPIKE.
   Prefix = category: P price, V volume, T trend, M momentum,
   X volatility, K multi-timeframe, R risk.
2. Each code is a function: (bars, side, ctx) -> True/False
   side = +1 (long) or -1 (short)
3. A tiny RULE LANGUAGE combines the codes:
      (P_CLOSE or P_RETEST) and CATS(3) and R_RR
   ALL(a,b,..)    every code true
   ANY(a,b,..)    at least one true
   N_OF(n,a,b,..) at least n true
   CATS(n)        true signals come from at least n different categories
                  (risk codes R_* don't count)
4. A weighted SCORE is also printed for context.

Usage:
  python confirmation_engine.py                  # demo with synthetic data
  python confirmation_engine.py prices.csv       # date,open,high,low,close,volume[,oi]
  python confirmation_engine.py prices.csv --rule "ALL(P_CLOSE,V_SPIKE) and CATS(3)"

Educational tool only. Not financial advice. Backtest before real use.
"""
import argparse
import ast
import csv
import random

# ----------------------------------------------------------------------
# Indicators
# ----------------------------------------------------------------------

def sma(x, n):
    return sum(x[-n:]) / n if len(x) >= n else None


def ema_series(x, n):
    a = 2 / (n + 1)
    out = [x[0]]
    for v in x[1:]:
        out.append(a * v + (1 - a) * out[-1])
    return out


def rsi_series(c, n=14):
    out = [None] * len(c)
    if len(c) <= n:
        return out
    g = [max(c[i] - c[i - 1], 0) for i in range(1, len(c))]
    l = [max(c[i - 1] - c[i], 0) for i in range(1, len(c))]
    ag, al = sum(g[:n]) / n, sum(l[:n]) / n
    out[n] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    for i in range(n, len(g)):
        ag = (ag * (n - 1) + g[i]) / n
        al = (al * (n - 1) + l[i]) / n
        out[i + 1] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


def true_ranges(bars):
    tr = [bars[0]["h"] - bars[0]["l"]]
    for i in range(1, len(bars)):
        h, l, pc = bars[i]["h"], bars[i]["l"], bars[i - 1]["c"]
        tr.append(max(h - l, abs(h - pc), abs(l - pc)))
    return tr


def atr_series(bars, n=14):
    tr = true_ranges(bars)
    out = [None] * len(bars)
    if len(bars) < n:
        return out
    a = sum(tr[:n]) / n
    out[n - 1] = a
    for i in range(n, len(bars)):
        a = (a * (n - 1) + tr[i]) / n
        out[i] = a
    return out


def adx(bars, n=14):
    """Returns (ADX, +DI, -DI) or None."""
    if len(bars) < 2 * n + 1:
        return None
    pdm, ndm = [], []
    for i in range(1, len(bars)):
        up = bars[i]["h"] - bars[i - 1]["h"]
        dn = bars[i - 1]["l"] - bars[i]["l"]
        pdm.append(up if up > dn and up > 0 else 0)
        ndm.append(dn if dn > up and dn > 0 else 0)
    tr = true_ranges(bars)[1:]

    def wilder(x):
        s = sum(x[:n])
        out = [s]
        for v in x[n:]:
            s = s - s / n + v
            out.append(s)
        return out

    trs, p, m = wilder(tr), wilder(pdm), wilder(ndm)
    dx, pdi, ndi = [], 0, 0
    for a, b, c in zip(trs, p, m):
        pdi = 100 * b / a if a else 0
        ndi = 100 * c / a if a else 0
        dx.append(100 * abs(pdi - ndi) / (pdi + ndi) if pdi + ndi else 0)
    val = sum(dx[:n]) / n
    for v in dx[n:]:
        val = (val * (n - 1) + v) / n
    return val, pdi, ndi


def bandwidth(closes, n=20):
    out = []
    for i in range(n, len(closes) + 1):
        w = closes[i - n:i]
        m = sum(w) / n
        sd = (sum((x - m) ** 2 for x in w) / n) ** 0.5
        out.append(4 * sd / m)
    return out


def obv_series(bars):
    out = [0]
    for i in range(1, len(bars)):
        d = bars[i]["c"] - bars[i - 1]["c"]
        out.append(out[-1] + (bars[i]["v"] if d > 0 else -bars[i]["v"] if d < 0 else 0))
    return out


def resample(bars, k):
    start = len(bars) % k
    out = []
    for i in range(start, len(bars) - k + 1, k):
        grp = bars[i:i + k]
        out.append({"o": grp[0]["o"], "h": max(b["h"] for b in grp),
                    "l": min(b["l"] for b in grp), "c": grp[-1]["c"],
                    "v": sum(b["v"] for b in grp), "oi": grp[-1].get("oi")})
    return out


# ----------------------------------------------------------------------
# Signal registry:  code -> (function, description, min_bars, weight)
# ----------------------------------------------------------------------
SIGNALS = {}


def signal(code, desc, need=30, weight=1.0):
    def deco(fn):
        def wrapped(bars, side, ctx):
            if len(bars) < need:
                return False
            try:
                return bool(fn(bars, side, ctx))
            except (IndexError, TypeError, ZeroDivisionError, KeyError):
                return False
        SIGNALS[code] = (wrapped, desc, need, weight)
        return wrapped
    return deco


# ---- P: price action -------------------------------------------------
@signal("P_CLOSE", "Close beyond prior 20-bar high/low", 25, 2.0)
def _(b, s, ctx):
    if s > 0:
        return b[-1]["c"] > max(x["h"] for x in b[-21:-1])
    return b[-1]["c"] < min(x["l"] for x in b[-21:-1])


@signal("P_RETEST", "Broke level, retested it, and it held", 35, 1.5)
def _(b, s, ctx):
    atr = atr_series(b)[-1]
    if s > 0:
        lvl = max(x["h"] for x in b[-26:-6])
        broke = any(x["c"] > lvl for x in b[-6:-1])
        return broke and b[-1]["c"] > lvl and min(x["l"] for x in b[-3:]) <= lvl + 0.3 * atr
    lvl = min(x["l"] for x in b[-26:-6])
    broke = any(x["c"] < lvl for x in b[-6:-1])
    return broke and b[-1]["c"] < lvl and max(x["h"] for x in b[-3:]) >= lvl - 0.3 * atr


@signal("P_HHHL", "Higher highs + higher lows (lower/lower for short)", 12)
def _(b, s, ctx):
    hi1, hi0 = max(x["h"] for x in b[-5:]), max(x["h"] for x in b[-10:-5])
    lo1, lo0 = min(x["l"] for x in b[-5:]), min(x["l"] for x in b[-10:-5])
    return (hi1 > hi0 and lo1 > lo0) if s > 0 else (hi1 < hi0 and lo1 < lo0)


@signal("P_ENGULF", "Engulfing candle in trade direction", 3)
def _(b, s, ctx):
    p, c = b[-2], b[-1]
    if s > 0:
        return p["c"] < p["o"] and c["c"] > c["o"] and c["o"] <= p["c"] and c["c"] >= p["o"]
    return p["c"] > p["o"] and c["c"] < c["o"] and c["o"] >= p["c"] and c["c"] <= p["o"]


@signal("P_FOLLOW", "Follow-through: 3 closes in a row in direction", 4)
def _(b, s, ctx):
    return (b[-1]["c"] > b[-2]["c"] > b[-3]["c"]) if s > 0 else (b[-1]["c"] < b[-2]["c"] < b[-3]["c"])


# ---- V: volume / participation --------------------------------------
@signal("V_SPIKE", "Volume > 1.5x its 20-bar average", 22, 1.5)
def _(b, s, ctx):
    avg = sum(x["v"] for x in b[-21:-1]) / 20
    return b[-1]["v"] > 1.5 * avg


@signal("V_OI", "Open interest rising with the move", 8)
def _(b, s, ctx):
    oi_now, oi_then = b[-1]["oi"], b[-6]["oi"]
    move = b[-1]["c"] - b[-6]["c"]
    return oi_now is not None and oi_then is not None and oi_now > oi_then and move * s > 0


@signal("V_OBV", "On-balance volume trending with price", 12)
def _(b, s, ctx):
    o = obv_series(b)
    return (o[-1] > o[-10]) if s > 0 else (o[-1] < o[-10])


# ---- T: trend / moving averages -------------------------------------
@signal("T_MA50", "Price above (below) 50-bar average", 50)
def _(b, s, ctx):
    m = sma([x["c"] for x in b], 50)
    return b[-1]["c"] > m if s > 0 else b[-1]["c"] < m


@signal("T_MAX", "20-bar average above (below) 50-bar", 50)
def _(b, s, ctx):
    c = [x["c"] for x in b]
    return sma(c, 20) > sma(c, 50) if s > 0 else sma(c, 20) < sma(c, 50)


@signal("T_SLOPE", "50-bar average sloping in direction", 56)
def _(b, s, ctx):
    c = [x["c"] for x in b]
    now, then = sma(c, 50), sma(c[:-5], 50)
    return now > then if s > 0 else now < then


@signal("T_ADX", "ADX > 25 with matching DI", 35, 1.5)
def _(b, s, ctx):
    a, pdi, ndi = adx(b)
    return a > 25 and (pdi > ndi if s > 0 else ndi > pdi)


# ---- M: momentum -----------------------------------------------------
@signal("M_RSI", "RSI past 50, rising, not yet extreme", 20)
def _(b, s, ctx):
    r = rsi_series([x["c"] for x in b])
    if s > 0:
        return 50 < r[-1] < 75 and r[-1] > r[-4]
    return 25 < r[-1] < 50 and r[-1] < r[-4]


@signal("M_RSIDIV", "RSI divergence vs price (reversal hint)", 40)
def _(b, s, ctx):
    c = [x["c"] for x in b]
    r = rsi_series(c)
    w1, w0 = range(len(c) - 10, len(c)), range(len(c) - 20, len(c) - 10)
    if s > 0:  # bullish: lower price low, higher RSI low
        i1, i0 = min(w1, key=lambda i: c[i]), min(w0, key=lambda i: c[i])
        return c[i1] < c[i0] and r[i1] > r[i0]
    i1, i0 = max(w1, key=lambda i: c[i]), max(w0, key=lambda i: c[i])
    return c[i1] > c[i0] and r[i1] < r[i0]


@signal("M_MACD", "MACD above signal with rising histogram", 40)
def _(b, s, ctx):
    c = [x["c"] for x in b]
    e12, e26 = ema_series(c, 12), ema_series(c, 26)
    macd = [a - z for a, z in zip(e12, e26)]
    sig = ema_series(macd, 9)
    h = [m - g for m, g in zip(macd, sig)]
    return (h[-1] > 0 and h[-1] > h[-2]) if s > 0 else (h[-1] < 0 and h[-1] < h[-2])


# ---- X: volatility ---------------------------------------------------
@signal("X_ATR", "ATR expanding vs its 20-bar average", 40)
def _(b, s, ctx):
    a = atr_series(b)
    vals = [v for v in a[-20:] if v is not None]
    return a[-1] > sum(vals) / len(vals)


@signal("X_SQZ", "Bollinger squeeze then expansion in direction", 75)
def _(b, s, ctx):
    c = [x["c"] for x in b]
    bw = bandwidth(c)
    squeezed = min(bw[-10:]) <= 0.8 * (sum(bw[-50:]) / 50)
    expanding = bw[-1] > bw[-3]
    mid = sma(c, 20)
    return squeezed and expanding and (c[-1] > mid if s > 0 else c[-1] < mid)


# ---- K: multi-timeframe ---------------------------------------------
@signal("K_MTF", "Higher timeframe (x5 bars) trend agrees", 80, 1.5)
def _(b, s, ctx):
    h = [x["c"] for x in resample(b, 5)]
    m = sma(h, 10)
    return h[-1] > m if s > 0 else h[-1] < m


# ---- R: risk checks (need ctx: entry, stop, target) ------------------
@signal("R_RR", "Reward-to-risk >= 2", 1, 2.0)
def _(b, s, ctx):
    reward = (ctx["target"] - ctx["entry"]) * s
    risk = (ctx["entry"] - ctx["stop"]) * s
    return risk > 0 and reward / risk >= 2


@signal("R_STOP", "Stop distance between 0.5 and 3 ATR", 20)
def _(b, s, ctx):
    atr = atr_series(b)[-1]
    risk = (ctx["entry"] - ctx["stop"]) * s
    return 0.5 * atr <= risk <= 3 * atr


# ----------------------------------------------------------------------
# Rule language (safe: parsed with ast, no arbitrary code)
# ----------------------------------------------------------------------
DEFAULT_RULE = "(P_CLOSE or P_RETEST) and CATS(3) and R_RR"
_ALLOWED = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp,
            ast.Not, ast.Call, ast.Name, ast.Load, ast.Constant)


def eval_rule(rule, results):
    funcs = {
        "ALL": lambda *a: all(a),
        "ANY": lambda *a: any(a),
        "N_OF": lambda n, *a: sum(bool(x) for x in a) >= n,
        "CATS": lambda n: len({k.split("_")[0] for k, v in results.items()
                               if v and not k.startswith("R_")}) >= n,
    }
    tree = ast.parse(rule, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED):
            raise ValueError(f"Not allowed in rule: {type(node).__name__}")
        if isinstance(node, ast.Call) and not (isinstance(node.func, ast.Name) and node.func.id in funcs):
            raise ValueError("Unknown function in rule")
        if isinstance(node, ast.Name) and node.id not in results and node.id not in funcs:
            raise ValueError(f"Unknown code: {node.id}")
        if isinstance(node, ast.Constant) and not isinstance(node.value, int):
            raise ValueError("Only whole numbers allowed")
    return bool(eval(compile(tree, "<rule>", "eval"), {"__builtins__": {}}, {**results, **funcs}))


# ----------------------------------------------------------------------
# Engine
# ----------------------------------------------------------------------
def run_all(bars, side, ctx):
    return {code: fn(bars, side, ctx) for code, (fn, *_rest) in SIGNALS.items()}


def report(bars, side, ctx, rule):
    name = "LONG" if side > 0 else "SHORT"
    res = run_all(bars, side, ctx)
    total_w = sum(w for (_, _, _, w) in SIGNALS.values())
    got_w = sum(SIGNALS[c][3] for c, v in res.items() if v)
    cats = sorted({c.split("_")[0] for c, v in res.items() if v and not c.startswith("R_")})
    ok = eval_rule(rule, res)

    print(f"\n=== {name} CHECK ===")
    for code, passed in res.items():
        print(f"{'[x]' if passed else '[ ]'} {code:<9} {SIGNALS[code][1]}")
    print(f"Score: {got_w:.1f}/{total_w:.1f} ({100 * got_w / total_w:.0f}%)")
    print(f"Categories agreeing: {', '.join(cats) or 'none'}")
    print(f"Rule: {rule}")
    print(f"DECISION: {'ENTER ' + name if ok else 'WAIT'}")


def load_bars(path):
    bars = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            r = {k.lower(): v for k, v in r.items()}
            bars.append({"o": float(r["open"]), "h": float(r["high"]), "l": float(r["low"]),
                         "c": float(r["close"]), "v": float(r["volume"]),
                         "oi": float(r["oi"]) if r.get("oi") else None})
    return bars


def demo_bars(n=260, seed=7):
    """Synthetic prices (cents/bu style) ending in a high-volume breakout."""
    random.seed(seed)
    bars, price = [], 1100.0
    for i in range(n):
        o = price
        c = o + random.gauss(0.15 if i > 120 else 0, 4)
        h = max(o, c) + abs(random.gauss(0, 2))
        l = min(o, c) - abs(random.gauss(0, 2))
        bars.append({"o": o, "h": h, "l": l, "c": c,
                     "v": random.randint(8000, 12000),
                     "oi": 150000 + i * 20 + random.randint(-300, 300)})
        price = c
    top = max(x["h"] for x in bars[-20:])
    o = price
    c = max(top, o) + 10
    bars.append({"o": o, "h": c + 2, "l": o - 1, "c": c, "v": 22000, "oi": bars[-1]["oi"] + 900})
    return bars


def main():
    ap = argparse.ArgumentParser(description="Confirmation engine")
    ap.add_argument("csv", nargs="?", help="CSV: date,open,high,low,close,volume[,oi]")
    ap.add_argument("--rule", default=DEFAULT_RULE)
    ap.add_argument("--side", choices=["long", "short", "both"], default="both")
    ap.add_argument("--rr", type=float, default=2.25, help="target reward in multiples of risk")
    ap.add_argument("--stop-atr", type=float, default=2.0, help="stop distance in ATRs")
    a = ap.parse_args()

    if a.csv:
        bars = load_bars(a.csv)
    else:
        bars = demo_bars()
        print("Using demo data (synthetic prices, not real market data)")

    atr = atr_series(bars)[-1]
    entry = bars[-1]["c"]
    for side in ([1, -1] if a.side == "both" else [1 if a.side == "long" else -1]):
        stop = entry - side * a.stop_atr * atr
        target = entry + side * a.rr * a.stop_atr * atr
        report(bars, side, {"entry": entry, "stop": stop, "target": target}, a.rule)


if __name__ == "__main__":
    main()
