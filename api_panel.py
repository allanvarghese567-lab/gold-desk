"""API Buttons panel: CRUD buttons, run HTTP calls, brokers + history CSV."""
from __future__ import annotations

import csv
import json
import re
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

_VAR_RE = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")


def _sub_vars(text: str, variables: dict) -> str:
    if not text:
        return text or ""
    def repl(m):
        return str(variables.get(m.group(1), m.group(0)))
    return _VAR_RE.sub(repl, text)


def attach_api_panel(
    *,
    data_dir: Path,
    db_factory: Callable,
    oanda_token: str = "",
    oanda_account: str = "",
) -> APIRouter:
    router = APIRouter()
    brokers_csv = data_dir / "brokers.csv"
    history_csv = data_dir / "api_history.csv"

    def ensure_csv():
        data_dir.mkdir(parents=True, exist_ok=True)
        if not brokers_csv.exists():
            brokers_csv.write_text(
                "id,name,base_url,auth_type,notes,payload_model\n"
                "oanda_practice,OANDA Practice,https://api-fxpractice.oanda.com,bearer,Practice,"
                '"{""Authorization"":""Bearer {{OANDA_TOKEN}}""}"\n'
                "generic,Generic,https://httpbin.org,none,Test,{}\n"
            )
        if not history_csv.exists():
            history_csv.write_text(
                "id,ts,button_id,label,method,url,status,duration_ms,request_body,response_preview\n"
            )

    def read_brokers():
        ensure_csv()
        with brokers_csv.open(newline="", encoding="utf-8") as f:
            return [dict(r) for r in csv.DictReader(f)]

    def append_history(row: dict):
        ensure_csv()
        write_header = history_csv.stat().st_size == 0
        with history_csv.open("a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(
                f,
                fieldnames=[
                    "id", "ts", "button_id", "label", "method", "url",
                    "status", "duration_ms", "request_body", "response_preview",
                ],
            )
            if write_header:
                w.writeheader()
            w.writerow(row)

    def ensure_table():
        with db_factory() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS api_buttons (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    method TEXT NOT NULL DEFAULT 'GET',
                    url TEXT NOT NULL,
                    headers TEXT DEFAULT '{}',
                    payload TEXT DEFAULT '',
                    broker_id TEXT DEFAULT '',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            conn.commit()

    ensure_table()
    ensure_csv()

    @router.get("/api/buttons")
    async def list_buttons():
        with db_factory() as conn:
            rows = conn.execute(
                "SELECT id,label,method,url,headers,payload,broker_id,created_at,updated_at "
                "FROM api_buttons ORDER BY updated_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    @router.post("/api/buttons")
    async def create_button(req: Request):
        body = await req.json()
        label = (body.get("label") or "").strip()
        url = (body.get("url") or "").strip()
        method = (body.get("method") or "GET").upper()
        if not label or not url:
            raise HTTPException(400, "label and url required")
        if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            raise HTTPException(400, "invalid method")
        bid = str(uuid.uuid4())
        now = int(time.time())
        headers = body.get("headers")
        if isinstance(headers, dict):
            headers = json.dumps(headers)
        headers = headers or "{}"
        payload = body.get("payload") or ""
        broker_id = body.get("broker_id") or ""
        with db_factory() as conn:
            conn.execute(
                "INSERT INTO api_buttons (id,label,method,url,headers,payload,broker_id,created_at,updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (bid, label, method, url, headers, payload, broker_id, now, now),
            )
            conn.commit()
        return {"id": bid, "label": label, "method": method, "url": url}

    @router.put("/api/buttons/{button_id}")
    async def update_button(button_id: str, req: Request):
        body = await req.json()
        with db_factory() as conn:
            row = conn.execute("SELECT id FROM api_buttons WHERE id=?", (button_id,)).fetchone()
            if not row:
                raise HTTPException(404, "button not found")
            fields, vals = [], []
            for key in ("label", "method", "url", "headers", "payload", "broker_id"):
                if key in body:
                    val = body[key]
                    if key == "headers" and isinstance(val, dict):
                        val = json.dumps(val)
                    if key == "method":
                        val = str(val).upper()
                    fields.append(f"{key}=?")
                    vals.append(val)
            fields.append("updated_at=?")
            vals.append(int(time.time()))
            vals.append(button_id)
            conn.execute(f"UPDATE api_buttons SET {', '.join(fields)} WHERE id=?", vals)
            conn.commit()
        return {"ok": True, "id": button_id}

    @router.delete("/api/buttons/{button_id}")
    async def delete_button(button_id: str):
        with db_factory() as conn:
            cur = conn.execute("DELETE FROM api_buttons WHERE id=?", (button_id,))
            conn.commit()
            if cur.rowcount == 0:
                raise HTTPException(404, "button not found")
        return {"ok": True}

    @router.post("/api/buttons/{button_id}/run")
    async def run_button(button_id: str, req: Request):
        body = await req.json()
        variables = body.get("variables") or {}
        if not isinstance(variables, dict):
            raise HTTPException(400, "variables must be an object")
        with db_factory() as conn:
            row = conn.execute("SELECT * FROM api_buttons WHERE id=?", (button_id,)).fetchone()
        if not row:
            raise HTTPException(404, "button not found")
        method = row["method"]
        if "OANDA_TOKEN" not in variables and oanda_token:
            variables = {**variables, "OANDA_TOKEN": oanda_token}
        if "OANDA_ACCOUNT" not in variables and oanda_account:
            variables = {**variables, "OANDA_ACCOUNT": oanda_account}
        url = _sub_vars(row["url"], variables)
        try:
            headers = json.loads(row["headers"] or "{}")
        except Exception:
            headers = {}
        headers = {k: _sub_vars(str(v), variables) for k, v in headers.items()}
        payload_raw = _sub_vars(row["payload"] or "", variables)
        t0 = time.time()
        status = 0
        resp_text = ""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                kwargs: dict[str, Any] = {"headers": headers}
                if method in ("POST", "PUT", "PATCH") and payload_raw.strip():
                    try:
                        kwargs["json"] = json.loads(payload_raw)
                    except Exception:
                        kwargs["content"] = payload_raw.encode()
                        headers.setdefault("Content-Type", "text/plain")
                        kwargs["headers"] = headers
                r = await client.request(method, url, **kwargs)
                status = r.status_code
                resp_text = r.text[:4000]
        except Exception as e:
            status = 0
            resp_text = f"error: {e}"
        duration = int((time.time() - t0) * 1000)
        hid = str(uuid.uuid4())
        append_history({
            "id": hid,
            "ts": int(time.time()),
            "button_id": button_id,
            "label": row["label"],
            "method": method,
            "url": url,
            "status": status,
            "duration_ms": duration,
            "request_body": (payload_raw or "")[:2000],
            "response_preview": resp_text[:2000].replace("\n", " "),
        })
        return {
            "id": hid,
            "status": status,
            "duration_ms": duration,
            "url": url,
            "method": method,
            "request_body": payload_raw,
            "response": resp_text,
        }

    @router.get("/api/brokers")
    async def list_brokers():
        return {"brokers": read_brokers()}

    @router.post("/api/brokers")
    async def upsert_broker(req: Request):
        body = await req.json()
        ensure_csv()
        rows = read_brokers()
        bid = (body.get("id") or "").strip() or str(uuid.uuid4())[:8]
        new_row = {
            "id": bid,
            "name": body.get("name") or bid,
            "base_url": body.get("base_url") or "",
            "auth_type": body.get("auth_type") or "none",
            "notes": body.get("notes") or "",
            "payload_model": body.get("payload_model")
            if isinstance(body.get("payload_model"), str)
            else json.dumps(body.get("payload_model") or {}),
        }
        by_id = {r["id"]: r for r in rows}
        by_id[bid] = new_row
        with brokers_csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(
                f, fieldnames=["id", "name", "base_url", "auth_type", "notes", "payload_model"]
            )
            w.writeheader()
            for r in by_id.values():
                w.writerow(r)
        return {"ok": True, "broker": new_row}

    @router.get("/api/history")
    async def api_history(limit: int = Query(50, ge=1, le=500)):
        ensure_csv()
        with history_csv.open(newline="", encoding="utf-8") as f:
            rows = [dict(r) for r in csv.DictReader(f)]
        rows.reverse()
        return {"history": rows[:limit]}

    @router.delete("/api/history")
    async def clear_history():
        ensure_csv()
        history_csv.write_text(
            "id,ts,button_id,label,method,url,status,duration_ms,request_body,response_preview\n"
        )
        return {"ok": True}

    return router
