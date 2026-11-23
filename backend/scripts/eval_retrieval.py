"""Retrieval-only metrics on the gold set: is the clause that holds the answer found, and how high is it ranked?

Scores the search step on its own (no drafting, no judge; only the questions' embeddings are computed), for three
rankers over the same chunks: dense (pgvector cosine), keyword (Postgres full-text), and hybrid (both fused with RRF,
what the app uses). A chunk is relevant when it belongs to a gold item's expected document + clause.

    uv run python -m scripts.eval_retrieval                 # documents of the latest "eval ..." chat
    uv run python -m scripts.eval_retrieval --chat <chat-id>

Metrics (k = rank cut-off, over the gold questions that name their source clause):
  Hit@k     share of questions whose gold clause appears in the top k chunks
  MRR@20    mean of 1/rank of the first relevant chunk (0 if not in the top 20)
  nDCG@10   rank-discounted gain of relevant chunks in the top 10, normalised by the ideal ranking
  Evidence  share whose gold clause is among the final ~40 sentences actually sent to the model
"""

import argparse
import asyncio
import json
import math
from datetime import date
from pathlib import Path

from sqlalchemy import select

from app.config import get_settings
from app.core import retrieve as R
from app.db import SessionLocal
from app.llm.gemini import get_llm
from app.models import Chat, ChatDocument, Chunk, Clause, Document

ROOT = Path(__file__).resolve().parents[1]
KS = (1, 3, 5, 10, 20)


def _norm(ref: str) -> str:
    return ref.replace(" ", "").lower()


def _relevant(title: str, ref: str, gold: list[dict]) -> bool:
    return any(title.startswith(g["doc"]) and _norm(ref) == _norm(g["clause"]) for g in gold)


def _metrics(ranked: list[bool], n_rel: int) -> dict:
    """ranked: relevance of each retrieved chunk, best first."""
    first = next((i for i, r in enumerate(ranked) if r), None)
    out = {f"hit@{k}": int(first is not None and first < k) for k in KS}
    out["rr@20"] = 1 / (first + 1) if first is not None and first < 20 else 0.0
    dcg = sum(1 / math.log2(i + 2) for i, r in enumerate(ranked[:10]) if r)
    ideal = sum(1 / math.log2(i + 2) for i in range(min(max(n_rel, 1), 10)))
    out["ndcg@10"] = dcg / ideal if ideal else 0.0
    return out


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chat", default="", help="chat whose documents to search (default: the latest eval chat)")
    ap.add_argument("--gold", default="eval/gold.jsonl", help="question file, relative to backend/")
    args = ap.parse_args()
    s = get_settings()
    items = [json.loads(line) for line in (ROOT / args.gold).read_text(encoding="utf-8").splitlines() if line.strip()]
    items = [i for i in items if i.get("expected_citations")]

    async with SessionLocal() as session:
        chat_id = args.chat or (await session.execute(
            select(Chat.id).where(Chat.title.like("eval %")).order_by(Chat.created_at.desc()).limit(1))).scalar_one()
        doc_ids = list((await session.execute(select(ChatDocument.document_id).where(ChatDocument.chat_id == chat_id))).scalars())
        meta = {cid: (title, ref) for cid, title, ref in (await session.execute(
            select(Chunk.id, Document.title, Clause.clause_ref).join(Clause, Clause.id == Chunk.clause_id)
            .join(Document, Document.id == Chunk.document_id).where(Chunk.document_id.in_(doc_ids)))).all()}
        print(f"chat {chat_id}: {len(doc_ids)} documents, {len(meta)} chunks, {len(items)} questions with a gold clause\n")

        per: dict[str, list[dict]] = {"dense": [], "keyword": [], "hybrid": []}
        evidence_hits, misses = [], []
        for it in items:
            gold = it["expected_citations"]
            n_rel = sum(_relevant(t, r, gold) for t, r in meta.values())
            qvec = await get_llm().embed_query(it["q"])
            dense = await R._dense(session, qvec, 50, doc_ids)
            # the same keyword query and fusion weights as the app (app/core/retrieve.py)
            kw = await R._fts(session, await R.rare_terms(session, R.key_terms(it["q"]), s.fts_max_df, doc_ids), 50, doc_ids)
            hybrid = [(c, 0.0) for c in R.rrf(dense, kw, k=s.rrf_k, weights=[1.0, s.fts_weight])[:50]]
            for name, lst in (("dense", dense), ("keyword", kw), ("hybrid", hybrid)):
                per[name].append(_metrics([_relevant(*meta[c], gold) for c, _ in lst if c in meta], n_rel))
            # what the drafter actually sees: the evidence sentences after budgeting and amendment expansion
            as_of = date.fromisoformat(it["as_of"]) if it.get("as_of") else date.today()
            r = await R.retrieve(session, it["q"], as_of, doc_ids=doc_ids)
            evidence_hits.append(int(any(_relevant(e.doc_title, e.clause_ref, gold) for e in r.evidence)))
            if not per["hybrid"][-1]["hit@5"]:
                misses.append(f"  {it['id']:>4}  {it['q'][:70]}  (gold: {gold[0]['doc']} {gold[0]['clause']})")

    def avg(name: str, key: str) -> float:
        xs = [m[key] for m in per[name]]
        return sum(xs) / len(xs)

    keys = [f"hit@{k}" for k in KS] + ["rr@20", "ndcg@10"]
    labels = {"rr@20": "MRR@20", "ndcg@10": "nDCG@10"}
    print(f"{'metric':<10}" + "".join(f"{n:>10}" for n in per))
    for k in keys:
        print(f"{labels.get(k, k.replace('hit', 'Hit')):<10}" + "".join(f"{avg(n, k):>10.3f}" for n in per))
    print(f"\nEvidence recall (gold clause among the ~{s.max_evidence} sentences sent to the model): "
          f"{sum(evidence_hits)}/{len(evidence_hits)} = {sum(evidence_hits) / len(evidence_hits):.3f}")
    if misses:
        print("\nHybrid misses at k=5:")
        print("\n".join(misses))
    out = ROOT / "eval" / "results" / f"retrieval-{date.today():%Y%m%d}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"chat": chat_id, "n": len(items),
                               "metrics": {n: {k: round(avg(n, k), 3) for k in keys} for n in per},
                               "evidence_recall": round(sum(evidence_hits) / len(evidence_hits), 3)}, indent=2), encoding="utf-8")
    print(f"\nsaved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    asyncio.run(main())
