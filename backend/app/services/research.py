"""Broker-research RAG store: ingest documents, chunk + embed, and retrieve
the most relevant passages to ground the AI assistant.

This is reference material the assistant cites — it does NOT turn the assistant
into an advice engine. Compliance guardrails (no buy/sell/hold advice) still
apply; retrieved research is presented as cited context, and the assistant is
instructed to report it factually, not to parrot any recommendations it
contains as the platform's own advice."""
import logging

from app.core.compliance import audit_log
from app.db.database import ResearchChunk, ResearchDocument, SessionLocal
from app.llm.embeddings import cosine, embed_query, embed_texts

log = logging.getLogger(__name__)

_CHUNK_CHARS = 900
_OVERLAP = 150


def chunk_text(text: str) -> list[str]:
    """Paragraph-aware sliding-window chunker."""
    text = (text or "").strip()
    if not text:
        return []
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks, buf = [], ""
    for p in paras:
        if len(buf) + len(p) + 2 <= _CHUNK_CHARS:
            buf = f"{buf}\n\n{p}" if buf else p
        else:
            if buf:
                chunks.append(buf)
            # long single paragraph → hard split with overlap
            while len(p) > _CHUNK_CHARS:
                chunks.append(p[:_CHUNK_CHARS])
                p = p[_CHUNK_CHARS - _OVERLAP:]
            buf = p
    if buf:
        chunks.append(buf)
    return chunks


def extract_text(filename: str, data: bytes) -> str:
    """Extract plain text from an uploaded .pdf / .txt / .md file."""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        import io

        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    return data.decode("utf-8", errors="ignore")


async def ingest_document(*, title: str, text: str, source: str = "",
                          filename: str = "", uploaded_by: str = "") -> dict:
    """Chunk, embed and persist a research document."""
    chunks = chunk_text(text)
    if not chunks:
        raise ValueError("No extractable text found in the document.")
    vectors, method = await embed_texts(chunks)

    db = SessionLocal()
    try:
        doc = ResearchDocument(title=title.strip() or filename or "Untitled",
                               source=source.strip(), filename=filename,
                               uploaded_by=uploaded_by, chunk_count=len(chunks),
                               embedding_method=method)
        db.add(doc)
        db.flush()  # get doc.id
        for i, (c, v) in enumerate(zip(chunks, vectors)):
            db.add(ResearchChunk(document_id=doc.id, ordinal=i, text=c, embedding=v))
        db.commit()
        doc_id = doc.id
    finally:
        db.close()
    audit_log("research_ingested", doc_id=doc_id, title=title, chunks=len(chunks),
              method=method, by=uploaded_by)
    return {"id": doc_id, "title": title, "chunks": len(chunks),
            "embedding_method": method}


async def search(query: str, k: int = 4) -> list[dict]:
    """Return the top-k most relevant research chunks for a query."""
    qvec, _ = await embed_query(query)
    db = SessionLocal()
    try:
        rows = db.query(ResearchChunk).all()
        titles = {d.id: d for d in db.query(ResearchDocument).all()}
    finally:
        db.close()
    scored = []
    for r in rows:
        sim = cosine(qvec, r.embedding or [])
        if sim > 0:
            scored.append((sim, r))
    scored.sort(key=lambda t: t[0], reverse=True)
    out = []
    for sim, r in scored[:k]:
        doc = titles.get(r.document_id)
        out.append({
            "document_id": r.document_id,
            "title": doc.title if doc else "",
            "source": doc.source if doc else "",
            "ordinal": r.ordinal,
            "text": r.text,
            "similarity": round(sim, 3),
        })
    return out


def list_documents() -> list[dict]:
    db = SessionLocal()
    try:
        rows = db.query(ResearchDocument).order_by(ResearchDocument.created_at.desc()).all()
        return [{
            "id": d.id, "title": d.title, "source": d.source,
            "filename": d.filename, "chunk_count": d.chunk_count,
            "embedding_method": d.embedding_method,
            "uploaded_by": d.uploaded_by, "created_at": str(d.created_at),
        } for d in rows]
    finally:
        db.close()


def delete_document(doc_id: int) -> bool:
    db = SessionLocal()
    try:
        doc = db.get(ResearchDocument, doc_id)
        if not doc:
            return False
        db.query(ResearchChunk).filter_by(document_id=doc_id).delete()
        db.delete(doc)
        db.commit()
    finally:
        db.close()
    audit_log("research_deleted", doc_id=doc_id)
    return True
