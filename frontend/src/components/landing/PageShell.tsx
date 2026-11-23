import type { ReactNode } from "react";
import { motion } from "motion/react";
import { SOFT_EASE } from "@/lib/hero-timeline";
import { Navbar } from "./Navbar";

export function PageShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  intro: string;
  children?: ReactNode;
}) {
  return (
    <main className="bg-paper relative min-h-svh overflow-hidden">
      <Navbar />
      <div className="relative z-10 mx-auto max-w-[1200px] px-6 pb-28 pt-36 md:px-10 md:pt-44">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: SOFT_EASE }}
          className="mb-4 text-[15px] font-medium text-primary"
        >
          {eyebrow}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: SOFT_EASE, delay: 0.1 }}
          className="max-w-3xl font-display text-[clamp(2.4rem,4.6vw,4.2rem)] font-semibold leading-[1.05] tracking-[-0.015em]"
        >
          {title}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: SOFT_EASE, delay: 0.3 }}
          className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted-foreground"
        >
          {intro}
        </motion.p>
        {children && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: SOFT_EASE, delay: 0.5 }}
            className="mt-16"
          >
            {children}
          </motion.div>
        )}
      </div>
    </main>
  );
}

export function InfoCard({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-rule bg-card p-6">
      <p className="text-[0.875rem] font-medium text-primary">{label}</p>
      <h2 className="mt-3 font-display text-xl font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
