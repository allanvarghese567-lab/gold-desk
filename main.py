import asyncio, json, os, sqlite3, time, uuid
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

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


def publish(kind: str, payload: dict):
    msg = f"event: {kind}\ndata: {json.dumps(payload)}\n\n"
    for q in list(subscribers):
        if q.full():
            continue
        q.put_nowait(msg)


async def price_stream():
    url = f"{STREAM}/v3/accounts/{ACCOUNT}/pricing/stream"
    joined = ",".join(INSTRUMENTS)
    while True:
        try:
            async with httpx.AsyncClient(timeout=None) as c:
                async with c.stream("GET", url, headers=HEAD, params={"instruments": joined}) as r:
                    r.raise_for_status()
                    async for line in r.aiter_lines():
                        if not line:
                            continue
                        d = json.loads(line)
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
            print("stream error, retrying in 5s:", e)
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
    """TradingView alert → memory + SQLite log + optional open journal draft."""
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
            """
            SELECT id, received_at, instrument, side, price, tf, note
            FROM tv_webhook_log
            ORDER BY received_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/journal")
async def journal_list(
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
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


@app.get("/api/confirm")
async def confirm(
    side: str = Query("long", pattern="^(long|short)$"),
    granularity: str = Query("M15"),
    rule: str = Query(None),
    stop_atr: float = Query(2.0, ge=0.3, le=5.0),
    rr: float = Query(2.0, ge=1.0, le=10.0),
    instrument: str | None = None,
):
    if granularity not in {"M5", "M15", "H1", "H4", "D"}:
        raise HTTPException(400, "granularity must be M5, M15, H1, H4, or D")
    if not TOKEN:
        raise HTTPException(503, "OANDA_TOKEN not configured")

    ins = normalize_instrument(instrument)
    bars = await fetch_oanda_bars(granularity, 300, ins)
    if len(bars) < 60:
        raise HTTPException(502, "not enough candles from OANDA")

    atr = atr_series(bars)[-1]
    if not atr or atr <= 0:
        raise HTTPException(502, "ATR unavailable")

    entry = bars[-1]["c"]
    s = 1 if side == "long" else -1
    stop = entry - s * stop_atr * atr
    target = entry + s * rr * stop_atr * atr
    ctx = {"entry": entry, "stop": stop, "target": target}

    use_rule = rule or DEFAULT_RULE
    try:
        results = run_all(bars, s, ctx)
        decision = eval_rule(use_rule, results)
    except ValueError as e:
        raise HTTPException(400, str(e))

    total_w = sum(w for (_, _, _, w) in SIGNALS.values())
    got_w = sum(SIGNALS[c][3] for c, v in results.items() if v)
    cats = sorted({c.split("_")[0] for c, v in results.items() if v and not c.startswith("R_")})

    checks = [
        {
            "code": code,
            "ok": bool(results[code]),
            "desc": SIGNALS[code][1],
            "weight": SIGNALS[code][3],
            "category": code.split("_")[0],
        }
        for code in SIGNALS
    ]

    return {
        "instrument": ins,
        "side": side,
        "granularity": granularity,
        "entry": round(entry, 3),
        "stop": round(stop, 3),
        "target": round(target, 3),
        "atr": round(atr, 3),
        "stop_atr": stop_atr,
        "rr": rr,
        "rule": use_rule,
        "decision": "ENTER" if decision else "WAIT",
        "score": round(got_w, 2),
        "score_max": round(total_w, 2),
        "score_pct": round(100 * got_w / total_w, 1) if total_w else 0,
        "categories": cats,
        "checks": checks,
        "bar_count": len(bars),
        "bar_time": bars[-1]["time"],
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


app.mount("/static", StaticFiles(directory="static"), name="static")
