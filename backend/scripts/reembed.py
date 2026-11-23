"""Fill in missing chunk embeddings (only rows where embedding IS NULL; nothing else is touched).

Needed once for documents uploaded before the gemini-embedding-2 batching fix (2026-11-23): back then only the
first chunk of each document got a vector, so semantic search could not see the rest of the document.

uv run python -m scripts.reembed            # safe to re-run; prints what it filled
"""

import asyncio

from sqlalchemy import select

from app.db import SessionLocal
from app.llm.gemini import get_llm
from app.models import Chunk, Document

BATCH = 100


async def main() -> None:
    async with SessionLocal() as session:
        chunks = (await session.execute(select(Chunk).where(Chunk.embedding.is_(None)).order_by(Chunk.document_id))).scalars().all()
        if not chunks:
            print("every chunk already has an embedding")
            return
        print(f"embedding {len(chunks)} chunks...")
        for i in range(0, len(chunks), BATCH):
            part = chunks[i : i + BATCH]
            for c, v in zip(part, await get_llm().embed([c.text for c in part]), strict=True):
                c.embedding = v
            await session.commit()
        doc_ids = {c.document_id for c in chunks}
        for d in (await session.execute(select(Document).where(Document.id.in_(doc_ids)))).scalars():
            if d.ingest_status == "indexed_no_vectors":
                d.ingest_status, d.ingest_error = "indexed", None
        await session.commit()
        print(f"done: {len(chunks)} chunks across {len(doc_ids)} documents")


if __name__ == "__main__":
    asyncio.run(main())
