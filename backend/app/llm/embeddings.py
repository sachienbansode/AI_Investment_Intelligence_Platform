"""Text embeddings for the broker-research RAG store.

Uses OpenAI embeddings when an OpenAI key is configured; otherwise falls back
to a deterministic, dependency-free hashed bag-of-words embedding so the
feature works offline / without keys (lower quality, but functional).

Each stored vector records the method+dimension it was produced with, and the
similarity search only compares vectors of matching dimension — so switching
embedding backends never crashes (re-index to upgrade old vectors)."""
import hashlib
import logging
import math
import re

from app.config import get_settings

log = logging.getLogger(__name__)

_HASH_DIM = 256
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _hash_embed(text: str) -> list[float]:
    """Deterministic hashed TF embedding, L2-normalised."""
    vec = [0.0] * _HASH_DIM
    for tok in _TOKEN_RE.findall(text.lower()):
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        vec[h % _HASH_DIM] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def embedding_method() -> str:
    """Identifier of the embedding backend currently in use."""
    s = get_settings()
    if s.openai_api_key:
        return f"openai:{s.embedding_model}"
    return f"hash-{_HASH_DIM}"


async def embed_texts(texts: list[str]) -> tuple[list[list[float]], str]:
    """Return (vectors, method). Falls back to hashed embeddings on any error."""
    s = get_settings()
    method = embedding_method()
    if s.openai_api_key:
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=s.openai_api_key)
            resp = await client.embeddings.create(model=s.embedding_model, input=texts)
            return [d.embedding for d in resp.data], method
        except Exception as e:
            log.warning("OpenAI embeddings failed (%s); using hashed fallback", e)
            method = f"hash-{_HASH_DIM}"
    return [_hash_embed(t) for t in texts], method


async def embed_query(text: str) -> tuple[list[float], str]:
    vecs, method = await embed_texts([text])
    return vecs[0], method


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return -1.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)
