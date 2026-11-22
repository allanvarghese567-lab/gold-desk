import asyncio, json, os, sqlite3, time, uuid
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from api_panel import attach_api_panel
from confirmation_engine import (
    DEFAULT_RULE,
    SIGNALS,
    atr_series,
    eval_rule,
    run_all,
)

load_dotenv()
TOKEN = os.getenv("OANDA_TOKEN", "")
ACCOUNT = os.getenv("OANDA_ACCOUNT", "")
SECRET = os.getenv("TV_WEBHOOK_SECRET", "")
ENV = os.getenv("OANDA_ENV", "practice")
REST = "https://api-fxpractice.oanda.com" if ENV == "practice" else "https://api-fxtrade.oanda.com"
STREAM = "https://stream-fxpractice.oanda.com" if ENV == "practice" else "https://stream-fxtrade.oanda.com"
INSTRUMENTS = [
    "XAU_USD",
    "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "NZD_USD", "USD_CAD",
    "EUR_JPY", "GBP_JPY", "EUR_GBP", "AUD_JPY", "XAG_USD",
]
INSTRUMENT = INSTRUMENTS[0]
FF_FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
HEAD = {"Authorization": f"Bearer {TOKEN}", "Accept-Datetime-Format": "UNIX"}

subscribers: set[asyncio.Queue] = set()
signals: list[dict] = []
news_cache = {"at": 0.0, "data": []}

DATA_DIR = Path(os.getenv("DATA_DIR", "data"))
DB_PATH = DATA_DIR / "golddesk.db"


def _db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tv_webhook_log (
                id TEXT PRIMARY KEY,
                received_at INTEGER NOT NULL,
                instrument TEXT,
                side TEXT,
                price REAL,
                tf TEXT,
                note TEXT,
                raw_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tv_webhook_received ON tv_webhook_log(received_at DESC);

            CREATE TABLE IF NOT EXISTS journal (
                id TEXT PRIMARY KEY,
                opened_at INTEGER NOT NULL,
                closed_at INTEGER,
                instrument TEXT NOT NULL,
                side TEXT NOT NULL,
                style TEXT,
                session TEXT,
                granularity TEXT,
                entry REAL,
                stop REAL,
                target REAL,
                exit REAL,
                result_r REAL,
                status TEXT NOT NULL,
                source TEXT NOT NULL,
                confirm_score REAL,
                notes TEXT,
                tv_log_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_journal_opened ON journal(opened_at DESC);
            """
        )


def classify_session_ist(ts: int | None = None) -> str:
    ts = ts or int(time.time())
    ist = time.gmtime(ts + 19800)
    mins = ist.tm_hour * 60 + ist.tm_min
    if 18 * 60 + 30 <= mins < 21 * 60:
        return "overlap"
    if mins >= 18 * 60 + 30 or mins < 1 * 60 + 30:
        return "ny"
    if 12 * 60 + 30 <= mins < 21 * 60:
        return "london"
    if 5 * 60 + 30 <= mins < 12 * 60 + 30:
        return "asian"
    return "off"


def normalize_instrument(raw: str | None) -> str:
    if not raw:
        return INSTRUMENT
    key = raw.strip().upper().replace("/", "_").replace("-", "_").replace(" ", "_")
    if "_" not in key and len(key) == 6:
        key = key[:3] + "_" + key[3:]
    if key not in INSTRUMENTS:
        raise HTTPException(400, f"unsupported instrument: {raw}")
    return key


def log_tv_webhook(body: dict) -> dict:
    log_id = str(uuid.uuid4())
    t = int(body.get("t") or time.time())
    side_raw = str(body.get("side") or body.get("action") or "").strip().lower()
    side = None
    if side_raw in ("buy", "long"):
        side = "long"
    elif side_raw in ("sell", "short"):
        side = "short"

    instrument = None
    for key in ("instrument", "symbol", "ticker"):
        if body.get(key):
            try:
                instrument = normalize_instrument(str(body[key]))
            except HTTPException:
                instrument = str(body[key]).upper().replace("/", "_")
            break
    if not instrument:
        instrument = INSTRUMENT

    price = None
    for key in ("price", "close", "entry"):
        if body.get(key) is not None:
            try:
                price = float(body[key])
            except (TypeError, ValueError):
                price = None
            break

    tf = str(body.get("tf") or body.get("interval") or body.get("timeframe") or "") or None
    note = str(body.get("note") or body.get("message") or body.get("comment") or "") or None
    session = classify_session_ist(t)

    with _db() as conn:
        conn.execute(
            """
            INSERT INTO tv_webhook_log (id, received_at, instrument, side, price, tf, note, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (log_id, t, instrument, side, price, tf, note, json.dumps(body, default=str)),
        )
        journal_id = None
        if side and price is not None:
            journal_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO journal (
                    id, opened_at, closed_at, instrument, side, style, session, granularity,
                    entry, stop, target, exit, result_r, status, source, confirm_score, notes, tv_log_id
                ) VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, 'open', 'tv', NULL, ?, ?)
                """,
                (journal_id, t, instrument, side, session, tf, price, note, log_id),
            )
        conn.commit()

    return {
        "log_id": log_id,
        "journal_id": journal_id,
        "instrument": instrument,
        "side": side,
        "price": price,
        "session": session,
        "tf": tf,
    }


def compute_result_r(side: str, entry: float, stop: float, exit_px: float) -> float:
    risk = abs(float(entry) - float(stop))
    if risk <= 0:
        raise ValueError("stop must differ from entry")
    side = side.lower()
    if side == "long":
        return (float(exit_px) - float(entry)) / risk
    if side == "short":
        return (float(entry) - float(exit_px)) / risk
    raise ValueError("side must be long or short")


def journal_stats(rows: list) -> dict:
    closed = [r for r in rows if r["status"] in ("win", "loss", "be") and r["result_r"] is not None]
    n = len(closed)
    if n == 0:
        return {
            "n": 0, "wins": 0, "losses": 0, "be": 0,
            "win_rate": None, "avg_win_r": None, "avg_loss_r": None,
            "avg_r": None, "expectancy_r": None, "sum_r": None,
            "by_session": {}, "by_style": {}, "by_instrument": {},
        }
    win_rs = [float(r["result_r"]) for r in closed if r["status"] == "win"]
    loss_rs = [abs(float(r["result_r"])) for r in closed if r["status"] == "loss"]
    be_n = sum(1 for r in closed if r["status"] == "be")
    if not win_rs and not loss_rs:
        win_rs = [float(r["result_r"]) for r in closed if float(r["result_r"]) > 1e-9]
        loss_rs = [abs(float(r["result_r"])) for r in closed if float(r["result_r"]) < -1e-9]
        be_n = sum(1 for r in closed if abs(float(r["result_r"])) <= 1e-9)
    decided = len(win_rs) + len(loss_rs)
    wr = (len(win_rs) / decided) if decided else None
    avg_win = sum(win_rs) / len(win_rs) if win_rs else None
    avg_loss = sum(loss_rs) / len(loss_rs) if loss_rs else None
    all_r = [float(r["result_r"]) for r in closed]
    avg_r = sum(all_r) / n
    sum_r = sum(all_r)
    if wr is not None and avg_win is not None and avg_loss is not None:
        expectancy = wr * avg_win - (1 - wr) * avg_loss
    elif wr is not None and avg_win is not None and not loss_rs:
        expectancy = wr * avg_win
    elif decided and avg_loss is not None and not win_rs:
        expectancy = -avg_loss
    else:
        expectancy = avg_r

    def simple_bucket(key: str) -> dict:
        groups: dict[str, list] = {}
        for r in closed:
            groups.setdefault(r.get(key) or "unknown", []).append(r)
        out = {}
        for k, items in groups.items():
            rs = [float(x["result_r"]) for x in items]
            w = [x for x in rs if x > 1e-9]
            l = [abs(x) for x in rs if x < -1e-9]
            d = len(w) + len(l)
            wr_b = len(w) / d if d else None
            aw = sum(w) / len(w) if w else None
            al = sum(l) / len(l) if l else None
            if wr_b is not None and aw is not None and al is not None:
                e = wr_b * aw - (1 - wr_b) * al
            else:
                e = sum(rs) / len(rs) if rs else None
            out[k] = {
                "n": len(items),
                "win_rate": round(wr_b, 4) if wr_b is not None else None,
                "expectancy_r": round(e, 4) if e is not None else None,
                "avg_r": round(sum(rs) / len(rs), 4) if rs else None,
            }
        return out

    return {
        "n": n,
        "wins": len(win_rs),
        "losses": len(loss_rs),
        "be": be_n,
        "win_rate": round(wr, 4) if wr is not None else None,
        "avg_win_r": round(avg_win, 4) if avg_win is not None else None,
        "avg_loss_r": round(avg_loss, 4) if avg_loss is not None else None,
        "avg_r": round(avg_r, 4),
        "expectancy_r": round(expectancy, 4) if expectancy is not None else None,
        "sum_r": round(sum_r, 4),
        "by_session": simple_bucket("session"),
        "by_style": simple_bucket("style"),
        "by_instrument": simple_bucket("instrument"),
    }


def publish(kind: str, payload: dict):
    msg = f"event: {kind}\ndata: {json.dumps(payload)}\n\n"
    for q in list(subscribers):
        if q.full():
            continue
        q.put_nowait(msg)


async def price_stream():
    url = f"{STREAM}/v3/accounts/{ACCOUNT}/pricing/stream"
    joined = ",".join(INSTRUMENTS)
    headers = {**HEAD, "Accept": "application/json"}
    while True:
        try:
            async with httpx.AsyncClient(timeout=None) as c:
                async with c.stream("GET", url, headers=headers, params={"instruments": joined}) as r:
                    if r.status_code != 200:
                        await asyncio.sleep(8)
                        continue
                    publish("status", {"stream": "live", "t": int(time.time())})
                    async for line in r.aiter_lines():
                        if not line:
                            continue
                        try:
                            d = json.loads(line)
                        except Exception:
                            continue
                        if d.get("type") == "HEARTBEAT":
                            continue
                        if d.get("type") != "PRICE" or not d.get("bids") or not d.get("asks"):
                            continue
                        bid, ask = float(d["bids"][0]["price"]), float(d["asks"][0]["price"])
                        ins = d.get("instrument") or INSTRUMENT
                        decimals = 3 if ins.startswith("XAU") or ins.startswith("XAG") else (3 if ins.endswith("JPY") else 5)
                        mid = round((bid + ask) / 2, decimals)
                        publish("tick", {
                            "t": int(time.time()),
                            "instrument": ins,
                            "bid": bid,
                            "ask": ask,
                            "mid": mid,
                        })
        except Exception as e:
            publish("status", {"stream": "retry", "error": str(e)[:120], "t": int(time.time())})
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app):
    init_db()
    task = asyncio.create_task(price_stream()) if TOKEN else None
    if not TOKEN:
        print("OANDA_TOKEN missing: copy .env.example to .env and fill it in.")
    yield
    if task:
        task.cancel()


app = FastAPI(lifespan=lifespan)


async def fetch_oanda_bars(granularity: str = "M15", count: int = 300, instrument: str | None = None):
    ins = normalize_instrument(instrument)
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"{REST}/v3/instruments/{ins}/candles",
            headers=HEAD,
            params={"granularity": granularity, "count": min(count, 1000), "price": "M"},
        )
    if r.status_code != 200:
        raise HTTPException(502, r.text)
    bars = []
    for k in r.json().get("candles", []):
        m = k["mid"]
        bars.append({
            "o": float(m["o"]),
            "h": float(m["h"]),
            "l": float(m["l"]),
            "c": float(m["c"]),
            "v": float(k.get("volume") or 0),
            "oi": None,
            "time": int(float(k["time"])),
        })
    return bars


@app.get("/api/pricing")
async def pricing_snapshot(instrument: str | None = None):
    if not TOKEN or not ACCOUNT:
        raise HTTPException(503, "OANDA not configured")
    ins = normalize_instrument(instrument)
    async with httpx.AsyncClient(timeout=12) as c:
        r = await c.get(
            f"{REST}/v3/accounts/{ACCOUNT}/pricing",
            headers=HEAD,
            params={"instruments": ins},
        )
    if r.status_code != 200:
        raise HTTPException(502, r.text[:300])
    prices = r.json().get("prices") or []
    if not prices:
        raise HTTPException(502, "no price")
    p = prices[0]
    bids, asks = p.get("bids") or [], p.get("asks") or []
    if not bids or not asks:
        raise HTTPException(502, "empty quotes")
    bid, ask = float(bids[0]["price"]), float(asks[0]["price"])
    decimals = 3 if ins.startswith("XAU") or ins.startswith("XAG") else (3 if ins.endswith("JPY") else 5)
    mid = round((bid + ask) / 2, decimals)
    return {"instrument": ins, "bid": bid, "ask": ask, "mid": mid, "t": int(time.time())}


@app.get("/api/instruments")
async def list_instruments():
    return {
        "default": INSTRUMENT,
        "instruments": [{"id": i, "label": i.replace("_", "/")} for i in INSTRUMENTS],
    }


@app.get("/api/candles")
async def candles(granularity: str = "M15", count: int = 500, instrument: str | None = None):
    if granularity not in {"M1", "M5", "M15", "H1", "H4", "D"}:
        raise HTTPException(400, "bad granularity")
    bars = await fetch_oanda_bars(granularity, count, instrument)
    return [
        {"time": b["time"], "open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"], "volume": b["v"]}
        for b in bars
    ]


@app.get("/api/news")
async def news():
    if time.time() - news_cache["at"] > 900:
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get(FF_FEED, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            news_cache.update(at=time.time(), data=r.json())
        except Exception as e:
            if not news_cache["data"]:
                raise HTTPException(502, f"feed unavailable: {e}")
    return [e for e in news_cache["data"] if e.get("country") == "USD"]


@app.post("/webhook/tv")
async def tv_webhook(req: Request):
    body = await req.json()
    if SECRET and body.get("secret") != SECRET:
        raise HTTPException(401, "bad secret")
    body = dict(body)
    body.pop("secret", None)
    body["t"] = int(time.time())
    logged = log_tv_webhook(body)
    body["log_id"] = logged["log_id"]
    if logged.get("journal_id"):
        body["journal_id"] = logged["journal_id"]
    signals.insert(0, body)
    del signals[50:]
    publish("signal", body)
    return {"ok": True, **logged}


@app.get("/api/signals")
async def get_signals(limit: int = Query(50, ge=1, le=200)):
    if signals:
        return signals[:limit]
    with _db() as conn:
        rows = conn.execute(
            "SELECT raw_json FROM tv_webhook_log ORDER BY received_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    out = []
    for r in rows:
        try:
            out.append(json.loads(r["raw_json"]))
        except Exception:
            continue
    return out


@app.get("/api/webhook/logs")
async def webhook_logs(limit: int = Query(50, ge=1, le=200)):
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, received_at, instrument, side, price, tf, note FROM tv_webhook_log ORDER BY received_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/journal")
async def journal_list(status: str | None = Query(None), limit: int = Query(50, ge=1, le=200)):
    q = "SELECT * FROM journal"
    args: list = []
    if status:
        q += " WHERE status = ?"
        args.append(status)
    q += " ORDER BY opened_at DESC LIMIT ?"
    args.append(limit)
    with _db() as conn:
        rows = conn.execute(q, args).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/journal")
async def journal_open(req: Request):
    body = await req.json()
    side = str(body.get("side") or "").strip().lower()
    if side in ("buy", "long"):
        side = "long"
    elif side in ("sell", "short"):
        side = "short"
    else:
        raise HTTPException(400, "side must be long/short")
    try:
        entry = float(body["entry"])
    except Exception:
        raise HTTPException(400, "entry required")
    stop = body.get("stop")
    target = body.get("target")
    try:
        stop = float(stop) if stop is not None else None
        target = float(target) if target is not None else None
    except (TypeError, ValueError):
        raise HTTPException(400, "stop/target must be numbers")
    ins = normalize_instrument(body.get("instrument"))
    tid = str(uuid.uuid4())
    t = int(time.time())
    session = classify_session_ist(t)
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO journal (
                id, opened_at, closed_at, instrument, side, style, session, granularity,
                entry, stop, target, exit, result_r, status, source, confirm_score, notes, tv_log_id
            ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'open', ?, ?, ?, NULL)
            """,
            (
                tid, t, ins, side,
                body.get("style"), session, body.get("granularity"),
                entry, stop, target,
                body.get("source") or "manual",
                body.get("confirm_score"),
                body.get("notes"),
            ),
        )
        conn.commit()
    return {"id": tid, "status": "open"}


@app.patch("/api/journal/{trade_id}/close")
async def journal_close(trade_id: str, req: Request):
    body = await req.json()
    try:
        exit_px = float(body["exit"])
    except Exception:
        raise HTTPException(400, "exit required")
    with _db() as conn:
        row = conn.execute("SELECT * FROM journal WHERE id=?", (trade_id,)).fetchone()
        if not row:
            raise HTTPException(404, "trade not found")
        if row["status"] != "open":
            raise HTTPException(400, "already closed")
        entry = float(row["entry"])
        stop = row["stop"]
        result_r = None
        status = "be"
        if stop is not None:
            try:
                result_r = compute_result_r(row["side"], entry, float(stop), exit_px)
                if abs(result_r) < 1e-9:
                    status = "be"
                elif result_r > 0:
                    status = "win"
                else:
                    status = "loss"
            except Exception:
                result_r = None
                status = "be"
        closed_at = int(time.time())
        conn.execute(
            "UPDATE journal SET closed_at=?, exit=?, result_r=?, status=? WHERE id=?",
            (closed_at, exit_px, result_r, status, trade_id),
        )
        conn.commit()
    return {"id": trade_id, "status": status, "result_r": result_r}


@app.get("/api/journal/stats")
async def journal_stats_api():
    with _db() as conn:
        rows = conn.execute("SELECT * FROM journal").fetchall()
    return journal_stats([dict(r) for r in rows])


@app.get("/api/confirm")
async def confirm(
    side: str = Query("long"),
    granularity: str = Query("M15"),
    instrument: str | None = None,
):
    side = side.lower()
    if side not in ("long", "short"):
        raise HTTPException(400, "side must be long or short")
    if granularity not in {"M1", "M5", "M15", "H1", "H4", "D"}:
        raise HTTPException(400, "bad granularity")
    bars = await fetch_oanda_bars(granularity, 300, instrument)
    if len(bars) < 30:
        raise HTTPException(502, "not enough bars")
    atr = atr_series(bars, 14)
    ctx = {
        "bars": bars,
        "atr": atr,
        "side": side,
        "instrument": normalize_instrument(instrument),
        "granularity": granularity,
    }
    results = run_all(ctx)
    score = sum(r["weight"] for r in results if r["ok"])
    score_max = sum(r["weight"] for r in results)
    ratio = score / score_max if score_max else 0
    decision = "ENTER" if ratio >= 0.55 else "WAIT"
    last = bars[-1]
    entry = last["c"]
    a = atr[-1] if atr else abs(last["h"] - last["l"])
    if side == "long":
        stop = entry - 1.5 * a
        target = entry + 2.5 * a
    else:
        stop = entry + 1.5 * a
        target = entry - 2.5 * a
    return {
        "decision": decision,
        "score": round(score, 2),
        "score_max": round(score_max, 2),
        "ratio": round(ratio, 4),
        "entry": round(entry, 5),
        "stop": round(stop, 5),
        "target": round(target, 5),
        "checks": results,
        "bar_time": last["time"],
    }


@app.get("/api/confirm/codes")
async def confirm_codes():
    return {
        "default_rule": DEFAULT_RULE,
        "codes": [
            {"code": code, "desc": desc, "need": need, "weight": weight, "category": code.split("_")[0]}
            for code, (_, desc, need, weight) in SIGNALS.items()
        ],
    }


@app.get("/stream")
async def stream(req: Request):
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    subscribers.add(q)

    async def gen():
        try:
            while not await req.is_disconnected():
                try:
                    yield await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            subscribers.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/")
async def index():
    return FileResponse("static/index.html")


app.include_router(
    attach_api_panel(
        data_dir=DATA_DIR,
        db_factory=_db,
        oanda_token=TOKEN,
        oanda_account=ACCOUNT,
    )
)

app.mount("/static", StaticFiles(directory="static"), name="static")
