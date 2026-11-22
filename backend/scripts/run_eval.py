"""Run the gold set against a running API and score it (plan Q11).

uv run python -m scripts.run_eval --base http://localhost:8000 --key $API_KEY [--ingest]
Writes eval/results/<timestamp>.json and .csv, prints a scoreboard."""

import argparse
import csv
import json
import statistics
import time
from datetime import datetime
from pathlib import Path

import httpx

from app.core.normalise import extract_values, matches

ROOT = Path(__file__).resolve().parents[1]


def ingest(c: httpx.Client) -> None:
    files = [("files", (p.name, p.read_bytes(), "application/pdf")) for p in sorted((ROOT / "corpus" / "pdf").glob("*.pdf"))]
    res = c.post("/api/documents", files=files).json()
    print("upload:", [(r["filename"], r["status"]) for r in res])
    for _ in range(300):
        docs = c.get("/api/documents").json()
        if all(d["ingest_status"] not in ("queued", "parsing", "embedding") for d in docs):
            break
        time.sleep(2)
    print("statuses:", {d["title"][:40]: d["ingest_status"] for d in c.get("/api/documents").json()})


def score(item: dict, ans: dict) -> dict:
    shown = [cl for cl in ans.get("claims", []) if cl["verdict"] in ("supported", "conflicted")]
    text = " ".join(cl["text"] for cl in shown)
    vals = extract_values(text)
    exp = [v for e in item.get("expected_values", []) for v in extract_values(e)]
    abstained = ans.get("status") == "abstained"
    correct = None
    if item["answerable"] and "expected_calc" in item:
        res = [c.get("result") for c in ans.get("calculations", []) if c and c.get("ok")]
        correct = any(abs((r or 0) - item["expected_calc"]) < 2 for r in res)
    elif item["answerable"] and exp:
        correct = all(any(matches(e, v) for v in vals) for e in exp)
    cites = [c for cl in shown for c in cl["citations"]]
    exp_c = item.get("expected_citations", [])
    citation_ok = None if not exp_c else any(
        c["doc_title"].startswith(e["doc"]) and c["clause_ref"].replace(" ", "") == e["clause"].replace(" ", "")
        for c in cites for e in exp_c)
    contra = bool(ans.get("contradictions")) or any(cl["verdict"] == "conflicted" for cl in ans.get("claims", []))
    return {
        "id": item["id"], "category": item["category"], "status": ans.get("status"), "correct": correct,
        "citation_ok": citation_ok, "abstained": abstained, "expected_abstain": not item["answerable"],
        "contradiction": contra, "expected_contradiction": bool(item.get("expect_contradiction")),
        "faithfulness": (ans.get("faithfulness") or {}).get("pct"),
        "pending_shown": any(ch.get("events") and any(e.get("state") == "not_yet_effective" for e in ch["events"])
                             for ch in ans.get("amendment_chains", [])),
        "latency_ms": (ans.get("timings_ms") or {}).get("total"), "cached": ans.get("cached"),
    }


def summary(rows: list[dict]) -> dict:
    def rate(xs):
        xs = [x for x in xs if x is not None]
        return round(sum(xs) / len(xs), 3) if xs else None

    abst = [r for r in rows if r["abstained"]]
    should = [r for r in rows if r["expected_abstain"]]
    contra = [r for r in rows if r["expected_contradiction"]]
    non_contra = [r for r in rows if not r["expected_contradiction"] and not r["expected_abstain"]]
    lat = [r["latency_ms"] for r in rows if r["latency_ms"] and not r["cached"]]
    return {
        "n": len(rows),
        "answer_correctness": rate([r["correct"] for r in rows]),
        "citation_validity": rate([r["citation_ok"] for r in rows]),
        "abstention_precision": round(sum(r["expected_abstain"] for r in abst) / len(abst), 3) if abst else None,
        "abstention_recall": round(sum(r["abstained"] for r in should) / len(should), 3) if should else None,
        "over_abstention": rate([r["abstained"] for r in rows if not r["expected_abstain"]]),
        "contradiction_recall": rate([r["contradiction"] for r in contra]),
        "false_conflict_rate": rate([r["contradiction"] for r in non_contra]),
        "mean_faithfulness_pct": round(statistics.mean([r["faithfulness"] for r in rows if r["faithfulness"] is not None]), 1),
        "latency_p50_ms": int(statistics.median(lat)) if lat else None,
        "latency_p95_ms": int(sorted(lat)[int(0.95 * (len(lat) - 1))]) if lat else None,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--key", required=True)
    ap.add_argument("--ingest", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated ids")
    args = ap.parse_args()
    c = httpx.Client(base_url=args.base, headers={"X-API-Key": args.key}, timeout=180)
    if args.ingest:
        ingest(c)
    items = [json.loads(line) for line in (ROOT / "eval" / "gold.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    if args.only:
        items = [i for i in items if i["id"] in args.only.split(",")]
    chat = c.post("/api/chats", json={"title": f"eval {datetime.now():%Y-%m-%d %H:%M}"}).json()["id"]
    rows = []
    for it in items:
        body = {"question": it["q"], **({"as_of": it["as_of"]} if it.get("as_of") else {})}
        r = c.post(f"/api/chats/{chat}/messages?stream=false", json=body)
        ans = r.json().get("answer", {}) if r.status_code == 200 else {"status": f"http {r.status_code}"}
        row = score(it, ans)
        rows.append(row)
        print(f"{it['id']:>3} {row['status']:<11} correct={row['correct']} cite={row['citation_ok']} "
              f"contra={row['contradiction']} {row['latency_ms']}ms")
    s = summary(rows)
    out = ROOT / "eval" / "results"
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    (out / f"{stamp}.json").write_text(json.dumps({"summary": s, "rows": rows}, indent=2), encoding="utf-8")
    with open(out / f"{stamp}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print("\nSCOREBOARD", json.dumps(s, indent=2))


if __name__ == "__main__":
    main()
