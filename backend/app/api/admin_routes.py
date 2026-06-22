"""Admin APIs (admin role only): audit log browser, LLM usage stats,
score quality review (maker-checker), user management."""
import calendar
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

from app.core.auth import hash_password, require_admin
from app.core.compliance import audit_log
from app.db.database import (ALL_PAGES, ChatFeedback, Instrument, PipelineRun, Role,
                             SessionLocal, StockScore, User)
from app.services.app_settings import DEFAULTS, all_settings, get_setting, set_setting

IST = ZoneInfo("Asia/Kolkata")


def fmt_ist(dt) -> str:
    """DDMMMYYYY hh:mm:ss AM/PM in IST."""
    if dt is None:
        return ""
    if isinstance(dt, (int, float)):
        dt = datetime.fromtimestamp(dt, tz=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST).strftime("%d%b%Y %I:%M:%S %p")

router = APIRouter(prefix="/api/v1/admin", tags=["admin"],
                   dependencies=[Depends(require_admin)])

def _read_audit(limit: int = 5000) -> list[dict]:
    from app.core.compliance import audit_log_path
    audit_file = Path(audit_log_path())
    if not audit_file.exists():
        return []
    lines = audit_file.read_text(encoding="utf-8", errors="ignore").splitlines()
    records = []
    for line in lines[-limit:]:
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


@router.get("/audit")
def audit_browser(event: str = "", limit: int = 100, offset: int = 0):
    records = [r for r in reversed(_read_audit())
               if not event or r.get("event") == event]
    total = len(records)
    page = records[offset:offset + limit]
    for r in page:
        r["time"] = datetime.fromtimestamp(r["ts"], tz=timezone.utc).isoformat()
    events = sorted({r.get("event", "") for r in records})
    return {"total": total, "events": events, "records": page}


@router.get("/stats")
def usage_stats():
    records = _read_audit()
    llm_calls = [r for r in records if r.get("event") == "llm_call"]
    by_provider: dict[str, int] = {}
    by_task: dict[str, int] = {}
    tokens_in = tokens_out = 0
    for r in llm_calls:
        by_provider[r.get("provider", "?")] = by_provider.get(r.get("provider", "?"), 0) + 1
        by_task[r.get("task", "?")] = by_task.get(r.get("task", "?"), 0) + 1
        usage = r.get("usage") or {}
        tokens_in += usage.get("input_tokens", 0) or 0
        tokens_out += usage.get("output_tokens", 0) or 0
    pipelines = [r for r in records if r.get("event") == "pipeline_complete"]
    logins = len([r for r in records if r.get("event") == "login_success"])
    db = SessionLocal()
    try:
        n_users = db.query(User).count()
        n_scores = db.query(StockScore).count()
    finally:
        db.close()
    return {
        "llm_calls_total": len(llm_calls), "llm_calls_by_provider": by_provider,
        "llm_calls_by_task": by_task,
        "tokens": {"input": tokens_in, "output": tokens_out},
        "pipeline_runs": len(pipelines),
        "last_pipeline": pipelines[-1] if pipelines else None,
        "logins": logins, "users": n_users, "scores_stored": n_scores,
    }


class ReviewRequest(BaseModel):
    status: str  # approved | rejected


@router.get("/scores/pending")
def pending_scores():
    db = SessionLocal()
    try:
        rows = (db.query(StockScore).order_by(StockScore.score_date.desc(),
                                              StockScore.symbol).limit(200).all())
        return [{
            "id": r.id, "symbol": r.symbol, "score_date": r.score_date,
            "composite_score": r.composite_score, "quality_status": r.quality_status,
            "explanation": r.explanation, "reviewed_by": r.reviewed_by,
            "ai_review": r.ai_review,
        } for r in rows]
    finally:
        db.close()


@router.get("/scores/history")
def scores_history(score_date: str = "", status: str = "", symbol: str = "",
                   limit: int = 100, offset: int = 0):
    """Full audit of scores across all runs: filterable, with per-date
    approved/rejected summary and reviewer attribution (auto vs human)."""
    from sqlalchemy import func
    db = SessionLocal()
    try:
        q = db.query(StockScore)
        if score_date:
            q = q.filter(StockScore.score_date == score_date)
        if status:
            q = q.filter(StockScore.quality_status == status)
        if symbol:
            q = q.filter(StockScore.symbol.like(f"%{symbol.upper()}%"))
        total = q.count()
        rows = (q.order_by(StockScore.score_date.desc(), StockScore.symbol)
                .offset(offset).limit(limit).all())

        summary_q = (db.query(StockScore.score_date, StockScore.quality_status,
                              func.count(StockScore.id))
                     .group_by(StockScore.score_date, StockScore.quality_status)
                     .order_by(StockScore.score_date.desc()).all())
        summary: dict[str, dict] = {}
        for d, st, n in summary_q:
            summary.setdefault(d, {"score_date": d, "approved": 0,
                                   "rejected": 0, "pending": 0})
            summary[d][st or "pending"] = n
        human = (db.query(func.count(StockScore.id))
                 .filter(StockScore.reviewed_by != "").scalar() or 0)

        return {
            "total": total,
            "human_reviewed_total": human,
            "summary": list(summary.values())[:30],
            "rows": [{
                "id": r.id, "symbol": r.symbol, "score_date": r.score_date,
                "composite_score": r.composite_score,
                "quality_status": r.quality_status,
                "explanation": r.explanation,
                "ai_review": r.ai_review,
                "reviewed_by": r.reviewed_by or "auto (Quality Agent)",
                "reviewed_at": str(r.reviewed_at) if r.reviewed_at else None,
                "created_at": str(r.created_at),
            } for r in rows],
        }
    finally:
        db.close()


@router.patch("/scores/{score_id}/review")
def review_score(score_id: int, req: ReviewRequest,
                 admin: User = Depends(require_admin)):
    if req.status not in ("approved", "rejected"):
        raise HTTPException(400, "status must be 'approved' or 'rejected'")
    db = SessionLocal()
    try:
        row = db.get(StockScore, score_id)
        if not row:
            raise HTTPException(404, "Score not found")
        row.quality_status = req.status
        row.reviewed_by = admin.email
        row.reviewed_at = datetime.now(timezone.utc)
        db.commit()
        audit_log("score_review", score_id=score_id, symbol=row.symbol,
                  status=req.status, reviewer=admin.email)
        return {"id": row.id, "symbol": row.symbol, "quality_status": row.quality_status}
    finally:
        db.close()


class BulkReviewRequest(BaseModel):
    set_status: str            # approved | rejected
    score_date: str = ""       # limit to this run date
    status: str = ""           # only rows currently in this status (e.g. pending)
    symbol: str = ""           # symbol contains


@router.post("/scores/review-bulk")
def review_scores_bulk(req: BulkReviewRequest, admin: User = Depends(require_admin)):
    """Approve or reject every score matching the given filters in one action.
    Filters mirror the Score-review screen (run date, current status, symbol)."""
    if req.set_status not in ("approved", "rejected"):
        raise HTTPException(400, "set_status must be 'approved' or 'rejected'")
    db = SessionLocal()
    try:
        q = db.query(StockScore)
        if req.score_date:
            q = q.filter(StockScore.score_date == req.score_date)
        if req.status:
            q = q.filter(StockScore.quality_status == req.status)
        if req.symbol:
            q = q.filter(StockScore.symbol.like(f"%{req.symbol.upper()}%"))
        n = q.update({StockScore.quality_status: req.set_status,
                      StockScore.reviewed_by: admin.email,
                      StockScore.reviewed_at: datetime.now(timezone.utc)},
                     synchronize_session=False)
        db.commit()
        audit_log("score_review_bulk", set_status=req.set_status, count=n,
                  score_date=req.score_date or "all", status_filter=req.status or "all",
                  symbol=req.symbol or "", reviewer=admin.email)
        return {"updated": n}
    finally:
        db.close()


@router.get("/users")
def list_users():
    db = SessionLocal()
    try:
        return [{"id": u.id, "email": u.email, "full_name": u.full_name,
                 "is_admin": bool(u.is_admin), "is_active": bool(u.is_active),
                 "role_id": u.role_id, "created_at": str(u.created_at)}
                for u in db.query(User).all()]
    finally:
        db.close()


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = ""
    is_admin: bool = False
    role_id: int | None = None


@router.post("/users")
def create_user(req: CreateUserRequest, admin: User = Depends(require_admin)):
    db = SessionLocal()
    try:
        if db.query(User).filter_by(email=req.email.lower()).first():
            raise HTTPException(409, "Email already exists")
        user = User(email=req.email.lower(), full_name=req.full_name,
                    hashed_password=hash_password(req.password), is_admin=req.is_admin,
                    role_id=req.role_id)
        db.add(user)
        db.commit()
        db.refresh(user)
    finally:
        db.close()
    audit_log("user_created", user=user.email, admin=req.is_admin, by=admin.email)
    return {"id": user.id, "email": user.email, "is_admin": bool(user.is_admin)}


@router.patch("/users/{user_id}/toggle-active")
def toggle_user(user_id: int, admin: User = Depends(require_admin)):
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(404, "User not found")
        if user.id == admin.id:
            raise HTTPException(400, "Cannot disable your own account")
        user.is_active = not user.is_active
        db.commit()
        result = {"id": user.id, "email": user.email, "is_active": bool(user.is_active)}
    finally:
        db.close()
    audit_log("user_toggled", **result, by=admin.email)
    return result


# ── Instruments management ───────────────────────────────────────
class InstrumentRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    name: str = ""
    sector: str = ""


@router.get("/instruments")
def admin_instruments():
    db = SessionLocal()
    try:
        rows = db.query(Instrument).order_by(Instrument.symbol).all()
        return [{"id": r.id, "symbol": r.symbol, "name": r.name, "sector": r.sector,
                 "is_active": bool(r.is_active),
                 "in_scoring_universe": bool(r.in_scoring_universe)} for r in rows]
    finally:
        db.close()


@router.post("/instruments")
def add_instrument(req: InstrumentRequest, admin: User = Depends(require_admin)):
    symbol = req.symbol.strip().upper()
    db = SessionLocal()
    try:
        if db.query(Instrument).filter_by(symbol=symbol).first():
            raise HTTPException(409, f"{symbol} already exists")
        row = Instrument(symbol=symbol, name=req.name.strip(), sector=req.sector.strip())
        db.add(row)
        db.commit()
        db.refresh(row)
    finally:
        db.close()
    audit_log("instrument_added", symbol=symbol, by=admin.email)
    return {"id": row.id, "symbol": row.symbol}


@router.patch("/instruments/{inst_id}/toggle/{field}")
def toggle_instrument(inst_id: int, field: str, admin: User = Depends(require_admin)):
    if field not in ("is_active", "in_scoring_universe"):
        raise HTTPException(400, "field must be is_active or in_scoring_universe")
    db = SessionLocal()
    try:
        row = db.get(Instrument, inst_id)
        if not row:
            raise HTTPException(404, "Instrument not found")
        setattr(row, field, not getattr(row, field))
        db.commit()
        result = {"id": row.id, "symbol": row.symbol, field: bool(getattr(row, field))}
    finally:
        db.close()
    audit_log("instrument_toggled", **result, by=admin.email)
    return result


@router.post("/instruments/import-nifty500")
async def import_nifty500(include_in_scoring: bool = True,
                          admin: User = Depends(require_admin)):
    """Import/refresh the NIFTY500 universe from NSE's official constituent CSV.
    Existing symbols are updated (name/sector); new ones are added."""
    import csv
    import io

    import httpx

    url = "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv"
    headers = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
               "Referer": "https://www.nseindia.com/"}
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
    except Exception as e:
        raise HTTPException(502, f"Could not download NIFTY500 list from NSE: {e}")

    reader = csv.DictReader(io.StringIO(r.text))
    added = updated = 0
    db = SessionLocal()
    try:
        for row in reader:
            symbol = (row.get("Symbol") or "").strip().upper()
            if not symbol:
                continue
            name = (row.get("Company Name") or "").strip()
            sector = (row.get("Industry") or "").strip()
            inst = db.query(Instrument).filter_by(symbol=symbol).first()
            if inst:
                inst.name = name or inst.name
                inst.sector = sector or inst.sector
                updated += 1
            else:
                db.add(Instrument(symbol=symbol, name=name, sector=sector,
                                  in_scoring_universe=include_in_scoring))
                added += 1
        db.commit()
        total = db.query(Instrument).count()
    finally:
        db.close()
    audit_log("nifty500_import", added=added, updated=updated, by=admin.email)
    return {"added": added, "updated": updated, "total_instruments": total,
            "note": "New scripts are " + ("included in" if include_in_scoring else "excluded from")
                    + " daily scoring. Adjust per script in Admin → Instruments."}


# ── Pipeline run audit ───────────────────────────────────────────
@router.get("/pipeline-runs")
def pipeline_runs(search: str = "", status: str = "", limit: int = 20, offset: int = 0):
    db = SessionLocal()
    try:
        q = db.query(PipelineRun)
        if search:
            q = q.filter(PipelineRun.run_id.like(f"%{search}%"))
        if status:
            q = q.filter(PipelineRun.status == status)
        total = q.count()
        rows = (q.order_by(PipelineRun.started.desc())
                .offset(offset).limit(limit).all())
        return {"total": total, "rows": [{
            "run_id": r.run_id,
            "started_ist": fmt_ist(r.started), "finished_ist": fmt_ist(r.finished),
            "duration_s": round((r.finished - r.started).total_seconds(), 1)
                          if r.started and r.finished else None,
            "status": r.status, "symbols_count": r.symbols_count,
            "agents": [{**a,
                        "started_ist": fmt_ist(a.get("started")),
                        "finished_ist": fmt_ist(a.get("finished"))}
                       for a in (r.agents or [])],
        } for r in rows]}
    finally:
        db.close()


@router.get("/pipeline-runs/export")
def export_pipeline_runs(search: str = "", status: str = ""):
    """Download the full run audit as an Excel workbook (Runs + Agent details)."""
    from openpyxl import Workbook
    from openpyxl.styles import Font

    db = SessionLocal()
    try:
        q = db.query(PipelineRun)
        if search:
            q = q.filter(PipelineRun.run_id.like(f"%{search}%"))
        if status:
            q = q.filter(PipelineRun.status == status)
        rows = q.order_by(PipelineRun.started.desc()).limit(5000).all()
    finally:
        db.close()

    if not rows:
        raise HTTPException(404, "No pipeline runs match the current filter — "
                                 "nothing to export. Run the scoring pipeline first.")

    wb = Workbook()
    ws = wb.active
    ws.title = "Pipeline Runs"
    headers = ["Run ID", "Started (IST)", "Finished (IST)", "Duration (s)",
               "Status", "Scripts", "Symbols"]
    ws.append(headers)
    for c in ws[1]:
        c.font = Font(bold=True)
    for r in rows:
        ws.append([r.run_id, fmt_ist(r.started), fmt_ist(r.finished),
                   round((r.finished - r.started).total_seconds(), 1)
                   if r.started and r.finished else "",
                   r.status, r.symbols_count,
                   ", ".join(r.symbols or [])[:1000]])

    ws2 = wb.create_sheet("Agent Details")
    ws2.append(["Run ID", "Agent", "Status", "Started (IST)", "Finished (IST)",
                "Duration (s)", "Detail"])
    for c in ws2[1]:
        c.font = Font(bold=True)
    for r in rows:
        for a in (r.agents or []):
            dur = (round(a["finished"] - a["started"], 1)
                   if a.get("started") and a.get("finished") else "")
            ws2.append([r.run_id, a.get("name"), a.get("status"),
                        fmt_ist(a.get("started")), fmt_ist(a.get("finished")),
                        dur, a.get("detail", "")])

    for sheet in (ws, ws2):
        for col in sheet.columns:
            width = max(len(str(c.value or "")) for c in col)
            sheet.column_dimensions[col[0].column_letter].width = min(width + 2, 60)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"pipeline_runs_{datetime.now(IST).strftime('%d%b%Y_%I%M%S%p')}.xlsx"
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ── LLM utilization & INR billing ────────────────────────────────
@router.get("/llm-usage")
def llm_usage():
    """Token utilization and INR cost from the audit trail: per provider,
    per pipeline stage, today / MTD actuals and month-end estimate."""
    pricing = get_setting("llm_pricing")
    usd_inr = float(pricing.get("usd_inr", 84.0))
    now = datetime.now(IST)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    days_in_month = calendar.monthrange(now.year, now.month)[1]

    def cost_inr(provider: str, tin: int, tout: int) -> float:
        p = pricing.get(provider, {})
        usd = (tin / 1e6) * float(p.get("input_usd_per_mtok", 0)) \
            + (tout / 1e6) * float(p.get("output_usd_per_mtok", 0))
        return usd * usd_inr

    by_provider: dict = {}
    by_task: dict = {}
    mtd_calls = 0
    today_cost = 0.0
    for rec in _read_audit(50000):
        if rec.get("event") != "llm_call":
            continue
        ts = datetime.fromtimestamp(rec["ts"], tz=timezone.utc).astimezone(IST)
        if ts < month_start:
            continue
        prov = rec.get("provider", "?")
        task = rec.get("task", "?")
        usage = rec.get("usage") or {}
        tin = usage.get("input_tokens") or usage.get("prompt_tokens") or 0
        tout = usage.get("output_tokens") or usage.get("completion_tokens") or 0
        c = cost_inr(prov, tin, tout)
        mtd_calls += 1
        p = by_provider.setdefault(prov, {"calls": 0, "input_tokens": 0,
                                          "output_tokens": 0, "cost_inr": 0.0})
        p["calls"] += 1; p["input_tokens"] += tin
        p["output_tokens"] += tout; p["cost_inr"] += c
        t = by_task.setdefault(task, {"calls": 0, "input_tokens": 0,
                                      "output_tokens": 0, "cost_inr": 0.0})
        t["calls"] += 1; t["input_tokens"] += tin
        t["output_tokens"] += tout; t["cost_inr"] += c
        if ts.date() == now.date():
            today_cost += c

    mtd_cost = sum(p["cost_inr"] for p in by_provider.values())
    est_month = mtd_cost / max(now.day, 1) * days_in_month
    for d in (*by_provider.values(), *by_task.values()):
        d["cost_inr"] = round(d["cost_inr"], 2)

    return {
        "as_of_ist": fmt_ist(datetime.now(timezone.utc)),
        "month": now.strftime("%b %Y"),
        "mtd": {"calls": mtd_calls, "cost_inr": round(mtd_cost, 2),
                "today_cost_inr": round(today_cost, 2)},
        "month_estimate_inr": round(est_month, 2),
        "by_provider": by_provider,
        "by_stage": by_task,
        "pricing": pricing,
        "note": "Estimates from audit-log token counts and the configurable rates in "
                "Settings (llm_pricing). Verify against provider invoices. Gemini "
                "token counts are not captured and bill as 0 here.",
    }


@router.get("/integrations")
def integrations():
    """All data/AI integrations. Public endpoints are shown in full (no secrets
    involved); the firm's own API keys are masked — full keys never leave the
    server (.env)."""
    from app.config import get_settings
    from app.data.rss_news import FEEDS
    s = get_settings()

    def mask(key: str) -> str:
        if not key:
            return ""
        if len(key) > 12:
            return key[:4] + "•" * 10 + key[-4:]
        return "•" * 12

    llm_providers = [
        {"name": "Anthropic Claude", "model": s.anthropic_model,
         "configured": bool(s.anthropic_api_key), "api_key_masked": mask(s.anthropic_api_key),
         "endpoint": "https://api.anthropic.com"},
        {"name": "OpenAI GPT", "model": s.openai_model,
         "configured": bool(s.openai_api_key), "api_key_masked": mask(s.openai_api_key),
         "endpoint": "https://api.openai.com"},
        {"name": "Google Gemini", "model": s.gemini_model,
         "configured": bool(s.google_api_key), "api_key_masked": mask(s.google_api_key),
         "endpoint": "https://generativelanguage.googleapis.com"},
    ]
    market_data = [
        {"name": "NSE India", "type": "public — no key required", "configured": True,
         "api_key_masked": "",
         "endpoints": ["https://www.nseindia.com/api/allIndices",
                       "https://www.nseindia.com/api/quote-equity?symbol={SYMBOL}",
                       "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv"]},
        {"name": "Yahoo Finance (fallback)", "type": "public — no key required",
         "configured": True, "api_key_masked": "",
         "endpoints": ["https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}.NS"]},
        {"name": "Zerodha Kite Connect", "type": "licensed broker feed",
         "configured": bool(s.kite_api_key and s.kite_access_token),
         "api_key_masked": mask(s.kite_api_key),
         "endpoints": ["https://api.kite.trade"]},
        {"name": "Angel One SmartAPI", "type": "licensed broker feed",
         "configured": bool(s.smartapi_key and s.smartapi_access_token),
         "api_key_masked": mask(s.smartapi_key),
         "endpoints": ["https://apiconnect.angelone.in"]},
        {"name": "Upstox", "type": "licensed broker feed",
         "configured": bool(s.upstox_access_token),
         "api_key_masked": mask(s.upstox_access_token),
         "endpoints": ["https://api.upstox.com/v2"]},
    ]
    news_feeds = [{"name": n, "url": u} for n, u in FEEDS.items()]
    return {"llm_providers": llm_providers, "market_data": market_data,
            "news_feeds": news_feeds,
            "note": "Keys are stored only in backend/.env on the server and are "
                    "masked here. To change a key, edit .env and restart the backend."}


# ── Broker-research RAG store ────────────────────────────────────
_MAX_RESEARCH_BYTES = 20 * 1024 * 1024  # 20 MB


@router.get("/research")
def research_list():
    from app.services import research
    return {"documents": research.list_documents(),
            "note": "Uploaded broker research grounds the AI assistant's answers "
                    "as cited reference material. The assistant reports it factually "
                    "and never presents it as buy/sell advice."}


@router.post("/research/upload")
async def research_upload(file: UploadFile = File(...), title: str = Form(""),
                          source: str = Form(""),
                          admin: User = Depends(require_admin)):
    """Upload a .pdf / .txt / .md research document into the RAG store."""
    from app.services import research
    data = await file.read()
    if len(data) > _MAX_RESEARCH_BYTES:
        raise HTTPException(413, "File too large (max 20 MB).")
    name = (file.filename or "").lower()
    if not name.endswith((".pdf", ".txt", ".md")):
        raise HTTPException(400, "Only .pdf, .txt or .md files are supported.")
    try:
        text = research.extract_text(file.filename, data)
        result = await research.ingest_document(
            title=title or file.filename, text=text, source=source,
            filename=file.filename, uploaded_by=admin.email)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(500, f"Failed to ingest document: {e}")
    return result


class ResearchTextRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    text: str = Field(min_length=1)
    source: str = ""


@router.post("/research/text")
async def research_text(req: ResearchTextRequest, admin: User = Depends(require_admin)):
    """Paste research text directly (no file) into the RAG store."""
    from app.services import research
    try:
        return await research.ingest_document(
            title=req.title, text=req.text, source=req.source,
            filename="", uploaded_by=admin.email)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.delete("/research/{doc_id}")
def research_delete(doc_id: int, admin: User = Depends(require_admin)):
    from app.services import research
    if not research.delete_document(doc_id):
        raise HTTPException(404, "Document not found")
    audit_log("research_deleted_by", doc_id=doc_id, by=admin.email)
    return {"deleted": doc_id}


# ── LLM connectivity test (diagnose AI failures) ─────────────────
@router.post("/llm-test")
async def llm_test():
    """Probe each configured LLM provider with a 1-token call and report which
    work and which fail (and why)."""
    from app.config import get_settings
    from app.llm.providers import AnthropicProvider, GeminiProvider, OpenAIProvider
    s = get_settings()
    candidates = [
        ("anthropic", AnthropicProvider, s.anthropic_model, bool(s.anthropic_api_key)),
        ("openai", OpenAIProvider, s.openai_model, bool(s.openai_api_key)),
        ("gemini", GeminiProvider, s.gemini_model, bool(s.google_api_key)),
    ]
    results = []
    for name, cls, model, has_key in candidates:
        if not has_key:
            results.append({"provider": name, "model": model, "configured": False,
                            "ok": False, "detail": "no API key in backend/.env"})
            continue
        try:
            p = cls()
            resp = await p.complete("You are a test.", "Reply with the single word OK.",
                                    max_tokens=5, temperature=0)
            results.append({"provider": name, "model": model, "configured": True,
                            "ok": True, "detail": (resp.text or "").strip()[:40]})
        except Exception as e:
            results.append({"provider": name, "model": model, "configured": True,
                            "ok": False, "detail": f"{type(e).__name__}: {str(e)[:200]}"})
    any_ok = any(r["ok"] for r in results)
    audit_log("llm_test", any_ok=any_ok,
              results=[{"provider": r["provider"], "ok": r["ok"]} for r in results])
    return {"any_provider_working": any_ok, "results": results,
            "note": "If all show ok=false, the AI Assistant returns 'AI service "
                    "unavailable'. Fix the key/model in backend/.env and restart."}


# ── RBAC: roles & page access ────────────────────────────────────
@router.get("/pages")
def page_catalog():
    return {"pages": ALL_PAGES}


@router.get("/roles")
def list_roles():
    db = SessionLocal()
    try:
        return [{"id": r.id, "name": r.name, "pages": r.pages or [],
                 "is_admin": bool(r.is_admin),
                 "users": db.query(User).filter_by(role_id=r.id).count()}
                for r in db.query(Role).order_by(Role.name).all()]
    finally:
        db.close()


class RoleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    pages: list[str] = []
    is_admin: bool = False


def _validate_pages(pages):
    bad = [p for p in pages if p not in ALL_PAGES]
    if bad:
        raise HTTPException(400, f"Unknown page(s): {', '.join(bad)}")


@router.post("/roles")
def create_role(req: RoleRequest, admin: User = Depends(require_admin)):
    _validate_pages(req.pages)
    db = SessionLocal()
    try:
        if db.query(Role).filter_by(name=req.name.strip()).first():
            raise HTTPException(409, "A role with that name already exists")
        role = Role(name=req.name.strip(), pages=req.pages, is_admin=req.is_admin)
        db.add(role); db.commit(); db.refresh(role)
        rid = role.id
    finally:
        db.close()
    audit_log("role_created", name=req.name, is_admin=req.is_admin, by=admin.email)
    return {"id": rid, "name": req.name}


@router.put("/roles/{role_id}")
def update_role(role_id: int, req: RoleRequest, admin: User = Depends(require_admin)):
    _validate_pages(req.pages)
    db = SessionLocal()
    try:
        role = db.get(Role, role_id)
        if not role:
            raise HTTPException(404, "Role not found")
        role.name = req.name.strip(); role.pages = req.pages; role.is_admin = req.is_admin
        db.commit()
    finally:
        db.close()
    audit_log("role_updated", id=role_id, by=admin.email)
    return {"id": role_id}


@router.delete("/roles/{role_id}")
def delete_role(role_id: int, admin: User = Depends(require_admin)):
    db = SessionLocal()
    try:
        role = db.get(Role, role_id)
        if not role:
            raise HTTPException(404, "Role not found")
        assigned = db.query(User).filter_by(role_id=role_id).count()
        if assigned:
            raise HTTPException(409, f"{assigned} user(s) still have this role; reassign first")
        db.delete(role); db.commit()
    finally:
        db.close()
    audit_log("role_deleted", id=role_id, by=admin.email)
    return {"deleted": role_id}


class UserRoleRequest(BaseModel):
    role_id: int | None = None


@router.patch("/users/{user_id}/role")
def set_user_role(user_id: int, req: UserRoleRequest, admin: User = Depends(require_admin)):
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(404, "User not found")
        if req.role_id is not None and not db.get(Role, req.role_id):
            raise HTTPException(404, "Role not found")
        user.role_id = req.role_id
        db.commit()
        result = {"id": user.id, "email": user.email, "role_id": user.role_id}
    finally:
        db.close()
    audit_log("user_role_set", **result, by=admin.email)
    return result


# ── Ops triggers (Agents screen) ─────────────────────────────────
@router.post("/refresh-news")
async def refresh_news_now(admin: User = Depends(require_admin)):
    from app.services import news_intel
    await news_intel.refresh_news()
    audit_log("news_refresh_manual", by=admin.email)
    return {"status": "news refreshed"}


# ── Chat audit (admin) ───────────────────────────────────────────
@router.get("/chat-audit")
def chat_audit(user_email: str = "", session: str = "", limit: int = 20, offset: int = 0):
    """Full conversation log: who asked what, when, the AI response, the LLM
    provider, confidence and latency. Filterable + paginated."""
    from app.db.database import ChatMessage
    db = SessionLocal()
    try:
        emails = {u.id: u.email for u in db.query(User).all()}
        q = db.query(ChatMessage)
        if user_email:
            uids = [uid for uid, em in emails.items()
                    if user_email.lower() in (em or "").lower()]
            q = q.filter(ChatMessage.user_id.in_(uids or [-1]))
        if session:
            q = q.filter(ChatMessage.session_id.like(f"%{session}%"))
        total = q.count()
        rows = (q.order_by(ChatMessage.created_at.desc())
                .offset(offset).limit(limit).all())
        out = [{
            "id": r.id, "time": str(r.created_at),
            "user": emails.get(r.user_id) or ("—" if r.user_id is None else f"user#{r.user_id}"),
            "session_id": r.session_id, "role": r.role, "content": r.content,
            "provider": (r.meta or {}).get("provider"),
            "confidence": (r.meta or {}).get("confidence"),
            "latency_ms": (r.meta or {}).get("latency_ms"),
            "sources": (r.meta or {}).get("n_sources"),
        } for r in rows]
        return {"total": total, "rows": out}
    finally:
        db.close()


# ── Branding (admin-uploaded logo / favicon) ─────────────────────
@router.post("/branding")
async def upload_branding(file: UploadFile = File(...), admin: User = Depends(require_admin)):
    """Upload a logo image (PNG/JPG/SVG/WebP). Stored as a data URI and used as
    the app logo and favicon everywhere."""
    import base64
    data = await file.read()
    if len(data) > 600 * 1024:
        raise HTTPException(413, "Logo too large (max 600 KB). Please upload a smaller image.")
    ct = (file.content_type or "").lower()
    if not ct.startswith("image/"):
        name = (file.filename or "").lower()
        ext = {"svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg",
               "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}
        ct = next((v for k, v in ext.items() if name.endswith("." + k)), "")
        if not ct:
            raise HTTPException(400, "Upload a PNG, JPG, SVG, WebP or GIF image.")
    uri = f"data:{ct};base64," + base64.b64encode(data).decode()
    set_setting("brand_logo", uri)
    audit_log("branding_uploaded", by=admin.email, bytes=len(data), type=ct)
    return {"ok": True, "bytes": len(data)}


@router.delete("/branding")
def clear_branding(admin: User = Depends(require_admin)):
    set_setting("brand_logo", "")
    audit_log("branding_cleared", by=admin.email)
    return {"ok": True}


# ── App settings (DB-configurable) ───────────────────────────────
class SettingUpdate(BaseModel):
    key: str
    value: object


@router.get("/settings")
def get_app_settings():
    return {"settings": all_settings(), "defaults": DEFAULTS}


@router.put("/settings")
def update_setting(req: SettingUpdate, admin: User = Depends(require_admin)):
    try:
        set_setting(req.key, req.value)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))
    note = "Saved."
    try:
        if req.key == "daily_scoring_hour":
            from app.main import reschedule_scoring
            ok = reschedule_scoring(req.value)
            note = (f"Scheduler updated live - next daily run at {int(req.value):02d}:00 IST."
                    if ok else "Saved, but live reschedule failed - restart to apply.")
        elif req.key == "news_refresh_minutes":
            from app.main import reschedule_news
            ok = reschedule_news(req.value)
            note = ("News refresh interval updated live."
                    if ok else "Saved, but live reschedule failed - restart to apply.")
    except Exception:
        note = "Saved - restart the backend to apply the new schedule."
    audit_log("setting_updated", key=req.key, value=req.value, by=admin.email)
    return {"key": req.key, "value": req.value, "note": note}


@router.get("/chat-feedback")
async def chat_feedback_list(rating: int = 0, limit: int = 50,
                             admin: User = Depends(require_admin)):
    """Assistant-quality view: thumbs up/down totals + recent rated answers
    (rating=-1 to see only negatives)."""
    db = SessionLocal()
    try:
        q = db.query(ChatFeedback)
        if rating in (1, -1):
            q = q.filter_by(rating=rating)
        rows = q.order_by(ChatFeedback.created_at.desc()).limit(min(max(limit, 1), 200)).all()
        up = db.query(ChatFeedback).filter_by(rating=1).count()
        down = db.query(ChatFeedback).filter_by(rating=-1).count()
        return {"up": up, "down": down, "items": [
            {"id": r.id, "rating": r.rating, "question": r.question, "answer": r.answer,
             "provider": r.provider, "session_id": r.session_id, "at": str(r.created_at)}
            for r in rows]}
    finally:
        db.close()
