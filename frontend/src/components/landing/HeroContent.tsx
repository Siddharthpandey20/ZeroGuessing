import { Link } from "@tanstack/react-router";
import { motion, type Variants } from "motion/react";
import { SOFT_EASE } from "@/lib/hero-timeline";

const rise: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: SOFT_EASE, delay },
  }),
};

export function HeroContent() {
  return (
    <div className="max-w-[34rem]">
      <motion.h1
        variants={rise}
        initial="hidden"
        animate="show"
        custom={0.1}
        className="font-display text-[clamp(2.5rem,4.5vw,4.4rem)] font-semibold leading-[1.04] tracking-[-0.015em] text-foreground"
      >
        Every answer, with the clause that proves it.
        <sup className="ml-0.5 align-super text-[0.38em] font-medium text-primary">
          <a
            href="#hero-note"
            aria-label="Footnote 1"
            className="rounded-sm px-0.5 hover:bg-highlight"
          >
            1
          </a>
        </sup>
      </motion.h1>

      <motion.p
        variants={rise}
        initial="hidden"
        animate="show"
        custom={0.3}
        className="mt-6 max-w-[31rem] text-[1.125rem] leading-[1.6] text-muted-foreground"
      >
        Ask one question across loan agreements, insurance policies and circulars. Veridoc quotes
        the exact clause and page, shows both sides when clauses disagree, follows amendments to the
        rule in force today, and says “I don't have proof” when the documents are silent.
      </motion.p>

      <motion.div
        variants={rise}
        initial="hidden"
        animate="show"
        custom={0.45}
        className="mt-8 flex flex-wrap items-center gap-3"
      >
        <Link to="/app" className="btn-ink px-5 py-3 text-[15px]">
          Open the workspace
        </Link>
        <Link to="/how-it-works" className="btn-quiet px-5 py-3 text-[15px]">
          How it works
        </Link>
      </motion.div>

      <motion.p
        id="hero-note"
        variants={rise}
        initial="hidden"
        animate="show"
        custom={0.6}
        className="mt-10 max-w-[30rem] text-[0.875rem] leading-[1.5] text-muted-foreground"
      >
        <span className="mb-2 block h-px w-14 bg-ink/40" aria-hidden="true" />
        <span className="mr-1 font-medium text-primary">1</span>
        Each sentence is matched to a verbatim quote, with its document and page, before you see it.
        A sentence with no matching quote is blocked, not shown.
      </motion.p>
    </div>
  );
}
