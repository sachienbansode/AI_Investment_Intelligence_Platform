"""Feedback-Triage agent — the safe self-improvement loop.

What it does
------------
1. Reads the 'not helpful' (thumbs-down) answers users left.
2. Groups them into recurring ISSUE CLUSTERS and, for each, proposes a FIX
   with a rationale.
3. The admin reviews each proposal and can approve / reject / add input. Adding
   input sends it back to the agent for a revised proposal (loops until approved).
4. On approval:
     * GUIDANCE fixes  -> appended to `assistant_learned_guidance` (a DB setting
       injected into the assistant's context) -> LIVE immediately, NO deployment.
     * SETTING fixes   -> a whitelisted app_setting is updated -> LIVE, NO deploy.
     * CODE fixes      -> ADVISORY ONLY. Marked 'approved' for a developer to
       implement through the normal git + deploy flow. The agent NEVER edits
       source code or hot-patches the running app — that stays human-gated for a
       SEBI-regulated production system.

So configuration/behaviour issues self-heal through an approval loop, while code
changes remain safely reviewed and deployed by a person.
"""
import json
import logging

from app.core.compliance import audit_log
from app.db.database import ChatFeedback, FixProposal, SessionLocal, utcnow
from app.services.app_settings import get_setting, set_setting

log = logging.getLogger(__name__)

# app_settings keys the agent is allowed to change on approval (conservative).
SAFE_SETTING_KEYS = {
    "assistant_max_tokens", "assistant_history_messages",
    "news_refresh_minutes", "max_news_items",
}

_PLAN_SYS = (
    "You are a quality analyst for an Indian stock-market AI assistant (SEBI-"
    "compliant: no buy/sell advice, no price targets). You are given a list of "
    "answers users marked NOT HELPFUL, each with the question. Group them into at "
    "most 8 recurring ISSUE CLUSTERS and, for each, propose ONE concrete fix.\n"
    "Prefer a GUIDANCE fix: a single short behavioural rule (<=350 chars) to add "
    "to the assistant's instructions (e.g. 'When asked which stocks are NOT in an "
    "index, list them from the instruments data instead of refusing.'). Use a "
    "SETTING fix only for one of these keys: assistant_max_tokens, "
    "assistant_history_messages, news_refresh_minutes, max_news_items. Use a CODE "
    "fix only when the problem truly needs new code (describe it; it will be "
    "reviewed by a developer). NEVER propose anything that weakens compliance, "
    "removes disclaimers, or adds investment advice.\n"
    'Return STRICT JSON only: {"clusters":[{"cluster_key":"slug-id",'
    '"title":"short label","summary":"what is going wrong","fix_type":'
    '"guidance|setting|code","fix_payload":{...},"rationale":"why this helps",'
    '"sample_questions":["..."]}]}. '
    'For guidance fix_payload={"text":"the rule"}; for setting fix_payload='
    '{"key":"...","value":...}; for code fix_payload={"description":"..."}.'
)


def _open_cluster_keys(db):
    rows = db.query(FixProposal.cluster_key).filter(
        FixProposal.status.in_(["pending", "needs_input", "approved", "applied"])).all()
    return {r[0] for r in rows}


async def run(max_items: int = 60) -> dict:
    """Cluster recent down-rated answers and create new fix proposals.
    Returns {created, considered, clusters}."""
    db = SessionLocal()
    try:
        fb = (db.query(ChatFeedback).filter(ChatFeedback.rating < 0)
              .order_by(ChatFeedback.created_at.desc()).limit(max_items).all())
        considered = len(fb)
        if not fb:
            _mark_run(0, 0)
            return {"created": 0, "considered": 0, "clusters": 0}
        items = [{"i": i, "q": (f.question or "")[:300], "a": (f.answer or "")[:500]}
                 for i, f in enumerate(fb)]
        clusters = await _plan(items)
        existing = _open_cluster_keys(db)
        created = 0
        for c in clusters:
            key = str(c.get("cluster_key") or "").strip().lower()[:80]
            if not key or key in existing:
                continue
            ft = (c.get("fix_type") or "guidance").lower()
            if ft not in ("guidance", "setting", "code"):
                ft = "guidance"
            payload = c.get("fix_payload") or {}
            if ft == "setting" and payload.get("key") not in SAFE_SETTING_KEYS:
                ft, payload = "code", {"description":
                    "Proposed setting change to a non-whitelisted key: " + json.dumps(payload)}
            samples = c.get("sample_questions") or []
            if not samples:
                samples = [it["q"] for it in items][:3]
            db.add(FixProposal(
                cluster_key=key, title=(c.get("title") or key)[:160],
                summary=(c.get("summary") or "")[:2000], sample_questions=samples[:5],
                fix_type=ft, fix_payload=payload,
                rationale=(c.get("rationale") or "")[:2000],
                status="pending", feedback_count=len(fb)))
            existing.add(key)
            created += 1
        db.commit()
        _mark_run(created, considered)
        audit_log("feedback_agent_run", created=created, considered=considered)
        return {"created": created, "considered": considered, "clusters": len(clusters)}
    finally:
        db.close()


async def _plan(items) -> list:
    """Ask the LLM to cluster + propose. Falls back to a single heuristic cluster."""
    try:
        from app.llm.router import get_llm_router
        prompt = "Down-rated answers (JSON):\n" + json.dumps(items, separators=(",", ":"))
        resp = await get_llm_router().complete(_PLAN_SYS, prompt, task="feedback_triage",
                                               max_tokens=1200, temperature=0.0)
        import re
        m = re.search(r"\{.*\}", resp.text, re.DOTALL)
        if m:
            data = json.loads(m.group(0))
            cl = data.get("clusters") or []
            if isinstance(cl, list) and cl:
                return cl
    except Exception as e:
        log.warning("feedback_agent plan failed: %s", e)
    # Heuristic fallback: one deflection cluster if any answer looks like a refusal.
    from app.services.answer_guard import looks_deflecting
    if any(looks_deflecting(it["a"]) for it in items):
        return [{
            "cluster_key": "deflection-on-data",
            "title": "Assistant deflects on data it has",
            "summary": "Several answers said the assistant lacks data or can't answer, "
                       "when platform data was available.",
            "fix_type": "guidance",
            "fix_payload": {"text": "Never say you lack data, can't query, or to contact "
                            "support for a data question — answer from the platform data you have."},
            "rationale": "Removes the most common 'not helpful' cause.",
            "sample_questions": [it["q"] for it in items[:3]],
        }]
    return []


async def revise(proposal_id: int, admin_note: str) -> dict:
    """Admin added input — ask the agent for a revised proposal, back to 'pending'."""
    db = SessionLocal()
    try:
        p = db.get(FixProposal, proposal_id)
        if not p:
            return {"ok": False, "error": "not found"}
        p.admin_note = (admin_note or "")[:2000]
        p.status = "needs_input"
        p.iterations = (p.iterations or 0) + 1
        db.commit()
        revised = await _revise_one({
            "title": p.title, "summary": p.summary, "fix_type": p.fix_type,
            "fix_payload": p.fix_payload, "rationale": p.rationale,
            "sample_questions": p.sample_questions or [],
        }, admin_note)
        if revised:
            ft = (revised.get("fix_type") or p.fix_type).lower()
            if ft not in ("guidance", "setting", "code"):
                ft = p.fix_type
            payload = revised.get("fix_payload") or p.fix_payload
            if ft == "setting" and payload.get("key") not in SAFE_SETTING_KEYS:
                ft, payload = "code", {"description": "Non-whitelisted setting: " + json.dumps(payload)}
            p.fix_type = ft
            p.fix_payload = payload
            p.summary = (revised.get("summary") or p.summary)[:2000]
            p.rationale = (revised.get("rationale") or p.rationale)[:2000]
        p.status = "pending"
        db.commit()
        audit_log("feedback_agent_revise", id=proposal_id, iterations=p.iterations)
        return {"ok": True}
    finally:
        db.close()


async def _revise_one(current, admin_note) -> dict | None:
    try:
        from app.llm.router import get_llm_router
        sys = (_PLAN_SYS + "\n\nYou are REVISING ONE existing proposal using the admin's "
               "input. Return STRICT JSON for a SINGLE object (not a clusters list) with the "
               "same fields (title, summary, fix_type, fix_payload, rationale).")
        prompt = ("Current proposal:\n" + json.dumps(current, separators=(",", ":"))
                  + "\n\nAdmin input: " + (admin_note or ""))
        resp = await get_llm_router().complete(sys, prompt, task="feedback_triage",
                                               max_tokens=700, temperature=0.0)
        import re
        m = re.search(r"\{.*\}", resp.text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
    except Exception as e:
        log.warning("feedback_agent revise failed: %s", e)
    return None


def decide(proposal_id: int, action: str, admin: str = "") -> dict:
    """Synchronous approve / reject. Approving a GUIDANCE/SETTING fix applies it
    LIVE; approving a CODE fix only marks it approved (needs deployment)."""
    db = SessionLocal()
    try:
        p = db.get(FixProposal, proposal_id)
        if not p:
            return {"ok": False, "error": "not found"}
        if action == "reject":
            p.status = "rejected"
            db.commit()
            audit_log("feedback_agent_reject", id=proposal_id, by=admin)
            return {"ok": True, "status": "rejected"}
        if action != "approve":
            return {"ok": False, "error": "unknown action"}
        ft = (p.fix_type or "guidance").lower()
        applied = False
        msg = ""
        if ft == "guidance":
            text = (p.fix_payload or {}).get("text", "").strip()
            if not text:
                return {"ok": False, "error": "empty guidance"}
            cur = list(get_setting("assistant_learned_guidance") or [])
            if text not in cur:
                cur.append(text)
                set_setting("assistant_learned_guidance", cur[-40:])
            applied = True
            msg = "Guidance applied live."
        elif ft == "setting":
            key = (p.fix_payload or {}).get("key")
            val = (p.fix_payload or {}).get("value")
            if key not in SAFE_SETTING_KEYS:
                return {"ok": False, "error": "setting key not allowed"}
            set_setting(key, val)
            applied = True
            msg = f"Setting '{key}' updated live."
        else:  # code
            p.status = "approved"
            db.commit()
            audit_log("feedback_agent_approve_code", id=proposal_id, by=admin)
            return {"ok": True, "status": "approved",
                    "message": "Code fix approved — a developer will implement and deploy it. "
                               "The agent does not change code on the live system."}
        p.status = "applied" if applied else "approved"
        db.commit()
        audit_log("feedback_agent_apply", id=proposal_id, fix_type=ft, by=admin)
        return {"ok": True, "status": p.status, "message": msg}
    finally:
        db.close()


def _row(p) -> dict:
    return {
        "id": p.id, "cluster_key": p.cluster_key, "title": p.title,
        "summary": p.summary, "sample_questions": p.sample_questions or [],
        "fix_type": p.fix_type, "fix_payload": p.fix_payload or {},
        "rationale": p.rationale, "status": p.status, "admin_note": p.admin_note or "",
        "iterations": p.iterations or 0, "feedback_count": p.feedback_count or 0,
        "created_at": str(p.created_at), "updated_at": str(p.updated_at),
    }


def listing(status: str = "", page: int = 1, per: int = 10) -> dict:
    db = SessionLocal()
    try:
        q = db.query(FixProposal)
        if status:
            q = q.filter(FixProposal.status == status)
        total = q.count()
        rows = (q.order_by(FixProposal.created_at.desc())
                .offset(max(0, (page - 1)) * per).limit(per).all())
        return {"items": [_row(p) for p in rows], "total": total,
                "page": page, "per": per, "status": status}
    finally:
        db.close()


def status() -> dict:
    db = SessionLocal()
    try:
        from sqlalchemy import func
        counts = dict(db.query(FixProposal.status, func.count(FixProposal.id))
                      .group_by(FixProposal.status).all())
        return {
            "counts": counts,
            "pending": counts.get("pending", 0),
            "applied": counts.get("applied", 0),
            "learned_rules": len(get_setting("assistant_learned_guidance") or []),
        }
    finally:
        db.close()


def _mark_run(created, considered):
    # best-effort; stored in audit only (avoid a new setting key for a transient stat)
    try:
        audit_log("feedback_agent_mark", created=created, considered=considered,
                  at=str(utcnow()))
    except Exception:
        pass
