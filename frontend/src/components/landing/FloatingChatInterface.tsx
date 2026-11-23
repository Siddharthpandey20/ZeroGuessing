import type { Ref } from "react";
import { motion } from "motion/react";
import {
  ArrowUp,
  Calculator,
  CircleSlash,
  FileText,
  MessageSquare,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PANEL_EMERGE_DURATION, SOFT_EASE, type HeroStageName } from "@/lib/hero-timeline";
import {
  CHAT_SCRIPT,
  FINISHED,
  SOURCES,
  graphemes,
  scriptTurn,
  turnStateAt,
  useChatLoop,
  type ChatNote,
  type ChatTurn,
  type TurnState,
} from "@/lib/chat-script";
import { BrandMark } from "./BrandMark";

export type PanelOrigin = { dx: number; dy: number; scale: number };

type Props = {
  ref?: Ref<HTMLDivElement>;
  reached: (stage: HeroStageName) => boolean;
  origin: PanelOrigin | null;
  instant: boolean;
};

const appear = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: SOFT_EASE },
};

function Note({ note }: { note: ChatNote }) {
  if (note.tone === "chain") {
    return (
      <div className="rounded-lg border border-border bg-muted/50 px-3.5 py-3">
        <p className="mb-2.5 font-medium text-foreground">{note.title}</p>
        <ol className="grid grid-cols-3 gap-2">
          {note.steps.map((s, i) => {
            const current = i === note.steps.length - 1;
            return (
              <li
                key={s.doc}
                className={cn(
                  "relative rounded-md border px-2.5 py-2 leading-tight",
                  current ? "border-verified/50 bg-verified/10" : "border-border",
                )}
              >
                <span
                  className={cn(
                    "block font-display text-[1.25em] font-semibold",
                    current ? "text-verified" : "text-muted-foreground line-through decoration-1",
                  )}
                >
                  {s.value}
                </span>
                <span className="mt-1 hidden truncate text-[0.9em] text-foreground/85 sm:block">
                  {s.doc}
                </span>
                <span className="mt-0.5 block text-[0.86em] text-muted-foreground">
                  {current ? `In force from ${s.date}` : `From ${s.date}`}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  const Icon = note.tone === "conflict" ? TriangleAlert : note.tone === "calc" ? Calculator : null;
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg border px-3.5 py-2.5 leading-snug",
        note.tone === "conflict"
          ? "border-conflict/35 bg-conflict/[0.08]"
          : "border-border bg-muted/50",
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            note.tone === "conflict" ? "text-conflict" : "text-primary",
          )}
        />
      )}
      <p className="text-muted-foreground">
        <span
          className={cn(
            "font-medium",
            note.tone === "conflict" ? "text-conflict" : "text-foreground",
          )}
        >
          {note.title}.{" "}
        </span>
        {note.body}
      </p>
    </div>
  );
}

function Turn({ turn, s }: { turn: ChatTurn; s: TurnState }) {
  if (!s.sent) return null;
  const words = turn.answer.split(" ");
  const showAssistant = s.thinking || s.words > 0;
  return (
    <motion.div
      layout="position"
      transition={{ duration: 0.5, ease: SOFT_EASE }}
      className="space-y-3"
    >
      <motion.div {...appear} className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 leading-snug text-accent-foreground">
          {turn.question}
        </div>
      </motion.div>

      {showAssistant && (
        <motion.div {...appear} className="flex gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-muted">
            <BrandMark className="h-[18px] w-[18px] text-foreground" />
          </span>
          <div className="min-h-7 flex-1 pt-0.5 leading-relaxed text-foreground">
            {s.thinking ? (
              <span className="flex h-6 items-center gap-1" aria-label="Reading documents">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-muted-foreground"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
            ) : (
              <p className="text-[1.07em]">
                {words.slice(0, s.words).map((w, i) => (
                  <span
                    key={i}
                    className={cn(turn.emphasis.includes(w) && "font-semibold text-white")}
                  >
                    {w}{" "}
                  </span>
                ))}
                {turn.evidence && s.evidence && (
                  <sup className="rounded bg-highlight px-1 py-px text-[0.68em] font-medium text-highlight-ink">
                    1
                  </sup>
                )}
              </p>
            )}
          </div>
        </motion.div>
      )}

      {turn.evidence && s.evidence && (
        <motion.div
          {...appear}
          className="ml-10 rounded-lg border border-border bg-muted/50 px-3.5 py-3"
        >
          <div className="mb-2 flex items-center justify-between gap-3 text-[0.9em]">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <FileText className="h-4 w-4 text-primary" />
              {turn.evidence.label}, page {turn.evidence.page}
            </span>
            <span className="text-muted-foreground">{turn.evidence.section}</span>
          </div>
          <p className="border-l-2 border-highlight/70 pl-3 leading-relaxed text-muted-foreground">
            “{turn.evidence.before}
            <mark className="mark-highlight">{turn.evidence.mark}</mark>
            {turn.evidence.after}”
          </p>
        </motion.div>
      )}

      {s.verdict && (
        <motion.div
          {...appear}
          className="ml-10 flex items-center justify-between gap-3 text-[0.9em]"
        >
          {turn.evidence ? (
            <>
              <span className="flex items-center gap-1.5 text-verified">
                <ShieldCheck className="h-4 w-4" /> Checked against the source text
              </span>
              <span className="text-muted-foreground">Faithfulness 100%</span>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CircleSlash className="h-4 w-4" /> No supporting source, so nothing is claimed
            </span>
          )}
        </motion.div>
      )}

      {turn.note && s.note && (
        <motion.div {...appear} className="ml-10 text-[0.92em]">
          <Note note={turn.note} />
        </motion.div>
      )}
    </motion.div>
  );
}

/** The app window that lifts out of the monitor in the drawing and keeps answering. */
export function FloatingChatInterface({ ref, reached, origin, instant }: Props) {
  const emerged = reached("emerge") && (origin !== null || instant);
  const { n, elapsed } = useChatLoop(reached("userMessage"), instant);

  const current = scriptTurn(n);
  const now = turnStateAt(current, elapsed, n === 0);
  const visible = [n - 2, n - 1, n].filter((k) => k >= 0);
  const cited = now.evidence ? current.evidence?.source : undefined;
  const composing = n > 0 && !now.sent;
  const typed = composing ? graphemes(current.question).slice(0, now.typedChars).join("") : "";

  const hidden = {
    opacity: 0,
    x: origin?.dx ?? 0,
    y: origin?.dy ?? 0,
    scale: origin?.scale ?? 0.2,
    filter: "blur(4px)",
  };

  return (
    <motion.div
      ref={ref}
      initial={instant ? false : hidden}
      animate={emerged ? { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" } : hidden}
      transition={
        emerged && !instant ? { duration: PANEL_EMERGE_DURATION, ease: SOFT_EASE } : { duration: 0 }
      }
      className="chat-slot z-30"
    >
      <div className="app-window surface-ink overflow-hidden rounded-xl text-[13px] lg:text-[14px]">
        {/* title bar */}
        <div className="relative flex h-10 items-center border-b border-border bg-window-bar px-4">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-3 w-3 rounded-full bg-foreground/15" />
            <span className="h-3 w-3 rounded-full bg-foreground/15" />
            <span className="h-3 w-3 rounded-full bg-foreground/15" />
          </div>
          <span className="absolute inset-x-0 text-center text-[0.9em] text-muted-foreground">
            Retail lending documents
          </span>
        </div>

        <div className="chat-body flex">
          {/* sidebar */}
          <aside className="hidden w-[30%] max-w-[230px] shrink-0 flex-col gap-5 border-r border-border bg-window-side px-3 py-3.5 sm:flex">
            <div>
              <p className="mb-1.5 px-1.5 text-[0.86em] font-medium text-muted-foreground">
                Sources
              </p>
              <ul className="space-y-0.5">
                {SOURCES.map((src) => (
                  <li
                    key={src.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-500",
                      cited === src.id ? "bg-primary/15 text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <FileText
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        cited === src.id ? "text-primary" : "opacity-70",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{src.name}</span>
                    <span
                      className={cn("text-[0.8em] opacity-60", now.thinking && "animate-pulse")}
                    >
                      {src.pages}p
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 px-1.5 text-[0.86em] font-medium text-muted-foreground">
                Recent
              </p>
              <ul className="space-y-0.5">
                {CHAT_SCRIPT.map((t) => (
                  <li
                    key={t.title}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-500",
                      t === current && now.sent
                        ? "bg-foreground/[0.07] text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* conversation */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="chat-fade relative flex-1 overflow-hidden">
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-5 px-5 pb-4">
                {visible.map((k) => (
                  <Turn key={k} turn={scriptTurn(k)} s={k === n ? now : FINISHED} />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-border px-4 py-3">
              <span className="min-w-0 flex-1 truncate">
                {composing && typed ? (
                  <span className="text-foreground">
                    {typed}
                    <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-primary" />
                  </span>
                ) : (
                  <span className="text-muted-foreground/70">
                    Ask about your documents, in English or Hindi
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors duration-300",
                  typed ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
