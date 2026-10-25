"""Runtime answer guard for the AI assistant.

Detects the single most common failure mode we keep seeing: the model
*deflects* on a data question it can actually answer -- "I don't have a live
list", "I can't run a query", "no real-time access", "contact customer support"
-- even though the platform data is sitting in its CONTEXT.

`looks_deflecting()` is intentionally conservative (it only matches phrases
that assert a lack of data / capability or punt to support). The caller only
acts on it when the question was genuinely grounded with platform data, so a
legitimate "I don't have the live market price right now" (a WEB figure we
really may lack) is never second-guessed.

Kept as its own module so the regression eval suite can test the matcher
directly, with no LLM calls.
"""
import re

# Phrases that assert a lack of data/capability, or deflect to support.
_DEFLECT = re.compile(
    r"i\s+don'?t\s+have|i\s+do\s+not\s+have|don'?t\s+currently\s+have|"
    r"i\s+can'?t\s+(?:run|execute|query|pull|fetch|access|retrieve|provide|filter|generate|give)|"
    r"i\s+cannot\s+(?:run|execute|query|pull|fetch|access|retrieve|provide|filter|generate|give)|"
    r"i'?m\s+(?:not\s+able|unable)\s+to|"
    r"no\s+(?:real[- ]?time|live|direct)\s*(?:access|data|information)|"
    r"don'?t\s+have\s+(?:a\s+)?(?:live|real[- ]?time|current|up[- ]?to[- ]?date|complete)?\s*"
    r"(?:list|data|access|information|visibility)|"
    r"contact\s+(?:customer\s+)?support|reach\s+out\s+to\s+(?:customer\s+)?support|"
    r"not\s+available\s+in\s+my\s+(?:context|data)|"
    r"outside\s+my\s+(?:current\s+)?(?:data|knowledge|context)",
    re.IGNORECASE)

# Signals in the assembled CONTEXT that mean we DID ground this question with
# platform data -- so a deflection is a bug, not an honest limitation.
_GROUNDING_MARKERS = (
    "DETERMINISTIC_ANSWER", "AI_SCORES_SUMMARY", "ALL_SCORES",
    "DB_QUERY_RESULTS", "MULTIDAY_SCORES", "SCORE_HISTORY_AVAILABLE",
)


def looks_deflecting(text: str) -> bool:
    """True if the answer asserts it lacks data / can't query / punts to support."""
    return bool(_DEFLECT.search(text or ""))


def is_grounded(context_parts, deterministic=None) -> bool:
    """True if we actually have platform data that should answer the question."""
    if deterministic:
        return True
    joined = "\n".join(context_parts or [])
    return any(m in joined for m in _GROUNDING_MARKERS)


# Appended to the user prompt on the single retry when a deflection is caught.
RETRY_NUDGE = (
    "\n\n[CRITICAL CORRECTION] Your previous draft wrongly claimed you lack data "
    "or cannot answer. You DO have the data needed in the CONTEXT above "
    "(NIYTRI Scores, the full daily score history, index membership, lists, "
    "prices and news). Answer the question DIRECTLY and specifically using that "
    "data. Do NOT say you don't have it, can't run/query/pull it, lack a live "
    "list, or to contact support."
)
