import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Worked examples, not feature cards. Every quote is verbatim from the sample
 * corpus (backend/corpus/pdf), with its real clause and page.
 */

function Row({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="grid gap-6 border-t border-rule py-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 lg:py-16">
      <div className="max-w-[26rem]">
        <h3 className="font-display text-[1.6rem] font-semibold leading-[1.15] text-foreground">
          {title}
        </h3>
        <p className="mt-3 text-muted-foreground">{body}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Source({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[0.8125rem] font-medium text-muted-foreground">{children}</p>;
}

const chain = [
  {
    doc: "Master Policy, clause 7.2",
    page: 1,
    date: "1 April 2025",
    value: "2%",
    quote: "shall be 2% (two per cent) of the outstanding principal",
  },
  {
    doc: "Circular 2025/14, ¶2",
    page: 1,
    date: "1 November 2025",
    value: "1%",
    quote: "shall be 1% (one per cent) of the outstanding principal",
  },
  {
    doc: "Circular 2026/03, ¶3",
    page: 1,
    date: "1 July 2026",
    value: "Nil",
    quote: "for individual borrowers shall be Nil",
  },
];

function ChainSpecimen() {
  return (
    <ol className="relative space-y-0">
      {chain.map((c, i) => {
        const current = i === chain.length - 1;
        return (
          <li
            key={c.doc}
            className="relative grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 pb-6 last:pb-0"
          >
            {i < chain.length - 1 && (
              <span
                className="absolute left-[2.2rem] top-12 bottom-1 w-px bg-ink/25"
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                "grid h-12 place-items-center rounded-md border font-display text-[1.35rem] font-semibold",
                current
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-rule bg-card text-muted-foreground line-through decoration-conflict decoration-2",
              )}
            >
              {c.value}
            </span>
            <div className="pt-0.5">
              <p className="font-medium text-foreground">
                {c.doc}
                <span className="font-normal text-muted-foreground">, page {c.page}</span>
              </p>
              <p className="text-[0.9375rem] text-muted-foreground">
                {current ? `In force from ${c.date}` : `Applied from ${c.date}, later replaced`}
              </p>
              <p className="mt-1.5 text-[0.9375rem] text-foreground/85">
                “…
                <mark className={current ? "mark-highlight" : "bg-transparent text-inherit"}>
                  {c.quote}
                </mark>
                .”
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ConflictSpecimen() {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <blockquote className="rounded-lg border border-rule bg-card p-4">
          <Source>Policy Wording, clause 4.3, page 1</Source>
          <p className="text-foreground">
            “A grace period of{" "}
            <span className="underline decoration-conflict decoration-2 underline-offset-4">
              30 days
            </span>{" "}
            from the premium due date is allowed, during which cover continues.”
          </p>
        </blockquote>
        <blockquote className="rounded-lg border border-rule bg-card p-4">
          <Source>Policy Schedule, clause 2.2, page 1</Source>
          <p className="text-foreground">
            “Grace period:{" "}
            <span className="underline decoration-conflict decoration-2 underline-offset-4">
              15 days
            </span>{" "}
            from the premium due date.”
          </p>
        </blockquote>
      </div>
      <p className="mt-3 text-[0.9375rem] text-conflict">
        Same subject, different numbers. Both quotes stay on screen and neither is chosen for you.
      </p>
    </div>
  );
}

function AbstainSpecimen() {
  return (
    <div className="rounded-lg border border-rule bg-card p-5">
      <p className="text-[0.9375rem] text-muted-foreground">
        What is the interest rate on gold loans?
      </p>
      <p className="mt-3 font-display text-[1.35rem] font-semibold leading-snug text-foreground">
        I don't have proof for this.
      </p>
      <p className="mt-2 text-foreground/85">
        Missing: an interest rate for gold loans. I searched 7 documents for “gold loans interest
        rate”. The closest passages, Master Policy clause 6.1 and Key Facts Statement clause 1.2,
        cover home loans only.
      </p>
    </div>
  );
}

const draft = [
  {
    text: "The prepayment penalty for individual borrowers is nil.",
    cite: "Circular 2026/03, ¶3",
    ok: true,
  },
  {
    text: "The processing fee is 1% of the loan amount, up to ₹25,000.",
    cite: "Master Policy, clause 6.3",
    ok: true,
  },
  {
    text: "The processing fee cap is ₹20,000.",
    cite: "Blocked: Circular 2026/03 ¶5 only takes effect on 1 January 2027",
    ok: false,
  },
];

function FaithfulnessSpecimen() {
  const backed = draft.filter((d) => d.ok).length;
  const pct = Math.round((backed / draft.length) * 100);
  return (
    <div className="rounded-lg border border-rule bg-card p-5">
      <ul className="space-y-3">
        {draft.map((d) => (
          <li key={d.text} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
            {d.ok ? (
              <Check className="mt-1 h-4 w-4 text-verified" aria-label="Backed by a quote" />
            ) : (
              <X className="mt-1 h-4 w-4 text-conflict" aria-label="Blocked" />
            )}
            <div>
              <p
                className={cn(
                  "text-foreground",
                  !d.ok && "text-muted-foreground line-through decoration-conflict",
                )}
              >
                {d.text}
              </p>
              <p
                className={cn("text-[0.8125rem]", d.ok ? "text-muted-foreground" : "text-conflict")}
              >
                {d.cite}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5 border-t border-rule pt-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-medium text-foreground">Faithfulness</p>
          <p className="font-display text-[1.5rem] font-semibold text-foreground">{pct}%</p>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1" aria-hidden="true">
          {draft.map((d) => (
            <span
              key={d.text}
              className={cn("h-1.5 rounded-full", d.ok ? "bg-verified" : "bg-conflict/40")}
            />
          ))}
        </div>
        <p className="mt-2 text-[0.875rem] text-muted-foreground">
          {backed} of {draft.length} drafted sentences are backed by a matching quote. The third
          never reaches the answer.
        </p>
      </div>
    </div>
  );
}

export function ProofSection() {
  return (
    <section aria-labelledby="proof-title" className="bg-paper">
      <div className="mx-auto max-w-[1440px] px-6 pb-12 pt-24 md:px-10 lg:pt-32">
        <div className="max-w-[46rem]">
          <h2
            id="proof-title"
            className="font-display text-[clamp(2rem,3.4vw,3rem)] font-semibold leading-[1.08] tracking-[-0.01em] text-foreground"
          >
            What a careful answer looks like
          </h2>
          <p className="mt-4 text-[1.0625rem] text-muted-foreground">
            Shown on the sample documents that come with Veridoc: a fictional bank's lending policy,
            two circulars that amend it, a key facts statement, and a home loan insurance policy.
          </p>
        </div>

        <div className="mt-14">
          <Row
            title="It follows amendments to the rule in force today."
            body="Circular 2026/03 replaces part of Circular 2025/14, which replaced clause 7.2 of the Master Policy. Veridoc resolves the chain by effective date and shows every step."
          >
            <ChainSpecimen />
          </Row>
          <Row
            title="It shows both sides when documents disagree."
            body="Clauses that state different numbers, dates or eligibility for the same thing are flagged, with both quotes side by side."
          >
            <ConflictSpecimen />
          </Row>
          <Row
            title="It says so when it has no proof."
            body="If nothing in your documents supports an answer, you get a plain statement of what is missing and where it looked, instead of a plausible guess."
          >
            <AbstainSpecimen />
          </Row>
          <Row
            title="It scores its own answer."
            body="Each drafted sentence is checked against its cited quote. Numbers must match, and the clause must be in force on the date you ask about."
          >
            <FaithfulnessSpecimen />
          </Row>
        </div>
      </div>
    </section>
  );
}
