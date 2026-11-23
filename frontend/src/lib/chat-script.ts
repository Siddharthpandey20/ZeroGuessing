import { useEffect, useState } from "react";
import { HERO_STAGES, type HeroStageName } from "./hero-timeline";

/**
 * The hero's demo conversation. Every quote below is copied verbatim from the
 * sample corpus in backend/corpus/pdf (a fictional bank and insurer), so the
 * landing page shows what the real pipeline returns, not invented text.
 */

export type SourceId = "master" | "c2514" | "c2603" | "kfs" | "wording" | "schedule" | "vendor";

export const SOURCES: { id: SourceId; name: string; pages: number }[] = [
  { id: "master", name: "Master Policy on Retail Loans", pages: 3 },
  { id: "c2514", name: "Circular 2025/14", pages: 1 },
  { id: "c2603", name: "Circular 2026/03", pages: 1 },
  { id: "kfs", name: "Key Facts Statement", pages: 1 },
  { id: "wording", name: "Policy Wording", pages: 1 },
  { id: "schedule", name: "Policy Schedule", pages: 1 },
  { id: "vendor", name: "Vendor Agreement", pages: 1 },
];

export type ChainStep = { doc: string; value: string; date: string };

export type ChatNote =
  | { tone: "conflict"; title: string; body: string }
  | { tone: "chain"; title: string; steps: ChainStep[] }
  | { tone: "calc"; title: string; body: string }
  | { tone: "neutral"; title: string; body: string };

export type ChatTurn = {
  title: string;
  question: string;
  answer: string;
  /** Words in the answer set in the strong text colour. */
  emphasis: string[];
  evidence: {
    source: SourceId;
    label: string;
    page: number;
    section: string;
    before: string;
    mark: string;
    after: string;
  } | null;
  note: ChatNote | null;
};

/** Conversations the demo window cycles through, in order, forever. */
export const CHAT_SCRIPT: ChatTurn[] = [
  {
    title: "Prepayment charge",
    question: "What prepayment penalty applies to a floating-rate home loan today?",
    answer: "Nil for individual borrowers, since 1 July 2026.",
    emphasis: ["Nil"],
    evidence: {
      source: "c2603",
      label: "Circular SCB/RL/2026/03",
      page: 1,
      section: "¶3",
      before: "The prepayment penalty on floating-rate home loans for individual borrowers ",
      mark: "shall be Nil",
      after: ".",
    },
    note: {
      tone: "chain",
      title: "Clause 7.2 was amended twice",
      steps: [
        { doc: "Master Policy 7.2", value: "2%", date: "1 Apr 2025" },
        { doc: "Circular 2025/14", value: "1%", date: "1 Nov 2025" },
        { doc: "Circular 2026/03", value: "Nil", date: "1 Jul 2026" },
      ],
    },
  },
  {
    title: "Grace period",
    question: "How long is the grace period for the insurance premium?",
    answer: "The policy wording allows 30 days from the premium due date.",
    emphasis: ["30", "days"],
    evidence: {
      source: "wording",
      label: "Policy Wording",
      page: 1,
      section: "4.3",
      before: "A grace period of ",
      mark: "30 days from the premium due date",
      after: " is allowed, during which cover continues.",
    },
    note: {
      tone: "conflict",
      title: "These documents disagree",
      body: "Policy Schedule clause 2.2 says “15 days from the premium due date.” Veridoc shows both and doesn't pick one.",
    },
  },
  {
    title: "Gold loans",
    question: "What is the interest rate on gold loans?",
    answer: "I don't have proof for this, so I won't guess.",
    emphasis: [],
    evidence: null,
    note: {
      tone: "neutral",
      title: "No answer given",
      body: "Searched 7 documents. None of them mention gold loans.",
    },
  },
  {
    title: "EMI, in Hindi",
    question: "इस होम लोन की मासिक EMI कितनी है?",
    answer: "मासिक EMI ₹27,965 बनती है।",
    emphasis: ["₹27,965"],
    evidence: {
      source: "kfs",
      label: "Key Facts Statement",
      page: 1,
      section: "1.2",
      before: "Rate of interest: ",
      mark: "9.50% p.a.",
      after: ", floating, linked to the External Benchmark Lending Rate.",
    },
    note: {
      tone: "calc",
      title: "Worked out, not guessed",
      body: "₹30,00,000 at 9.50% p.a. over 240 months, from clauses 1.1 to 1.3. The arithmetic runs in code, not in the model.",
    },
  },
];

/** Split into user-perceived characters, so Devanagari never shows half a letter while typing. */
export function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(seg.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

const stageAtMs = (name: HeroStageName) => HERO_STAGES.find((s) => s.name === name)!.at;
const since = (name: HeroStageName) => stageAtMs(name) - stageAtMs("userMessage");

/** Offsets (ms) after a question is sent; the first turn matches the hero schedule. */
export const TURN_OFFSETS = {
  thinking: since("typing"),
  answer: since("answer"),
  evidence: since("evidence"),
  verdict: since("verified"),
  note: since("contradiction"),
} as const;

export const CHAR_MS = 34;
export const WORD_MS = 45;
/** Pause after typing a question before it is sent. */
export const SEND_PAUSE_MS = 350;
/** How long a finished answer stays before the next question starts typing. */
export const HOLD_MS = 3600;

export function turnDuration(turn: ChatTurn, first: boolean) {
  const sent = first ? 0 : graphemes(turn.question).length * CHAR_MS + SEND_PAUSE_MS;
  return { sent, end: sent + TURN_OFFSETS.note + HOLD_MS };
}

export type TurnState = {
  typedChars: number;
  sent: boolean;
  thinking: boolean;
  words: number;
  evidence: boolean;
  verdict: boolean;
  note: boolean;
};

export function turnStateAt(turn: ChatTurn, elapsedMs: number, first: boolean): TurnState {
  const { sent } = turnDuration(turn, first);
  const t = elapsedMs - sent;
  const totalWords = turn.answer.split(" ").length;
  return {
    typedChars: Math.min(
      graphemes(turn.question).length,
      Math.max(0, Math.floor(elapsedMs / CHAR_MS)),
    ),
    sent: t >= 0,
    thinking: t >= TURN_OFFSETS.thinking && t < TURN_OFFSETS.answer,
    words:
      t < TURN_OFFSETS.answer
        ? 0
        : Math.min(totalWords, Math.floor((t - TURN_OFFSETS.answer) / WORD_MS) + 1),
    evidence: t >= TURN_OFFSETS.evidence,
    verdict: t >= TURN_OFFSETS.verdict,
    note: t >= TURN_OFFSETS.note,
  };
}

export const FINISHED: TurnState = {
  typedChars: 0,
  sent: true,
  thinking: false,
  words: Number.MAX_SAFE_INTEGER,
  evidence: true,
  verdict: true,
  note: true,
};

export const scriptTurn = (n: number) => CHAT_SCRIPT[n % CHAT_SCRIPT.length]!;

/**
 * Runs the demo conversation in a loop once `active` is true.
 * `n` counts turns since start; `elapsed` is ms into turn `n`.
 * Reduced-motion users get the first turn, finished, and no loop.
 */
export function useChatLoop(active: boolean, instant: boolean) {
  const [state, setState] = useState({ n: 0, elapsed: 0 });

  useEffect(() => {
    if (!active) return;
    if (instant) {
      setState({ n: 0, elapsed: turnDuration(scriptTurn(0), true).end - HOLD_MS });
      return;
    }
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      // Clamp so a throttled background tab doesn't skip whole turns.
      const dt = Math.min(now - last, 120);
      last = now;
      setState(({ n, elapsed }) => {
        const next = elapsed + dt;
        const end = turnDuration(scriptTurn(n), n === 0).end;
        return next >= end ? { n: n + 1, elapsed: 0 } : { n, elapsed: next };
      });
    }, 40);
    return () => window.clearInterval(id);
  }, [active, instant]);

  return state;
}
