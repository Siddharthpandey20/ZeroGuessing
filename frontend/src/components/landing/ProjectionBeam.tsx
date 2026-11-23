import { motion } from "motion/react";
import { SOFT_EASE } from "@/lib/hero-timeline";

export type Pt = { x: number; y: number };

/**
 * Callout lines from the small monitor to the enlarged window, as in a technical
 * drawing's "detail view": the window is the screen, drawn larger.
 */
export function ProjectionBeam({
  screen,
  panel,
  visible,
  instant,
}: {
  screen: Pt[];
  panel: Pt[];
  visible: boolean;
  instant: boolean;
}) {
  if (screen.length !== 4 || panel.length !== 4) return null;
  const box = screen.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <motion.svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 hidden h-full w-full overflow-visible lg:block"
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{
        duration: instant ? 0 : 0.9,
        ease: SOFT_EASE,
        delay: visible && !instant ? 0.6 : 0,
      }}
    >
      <polygon
        points={box}
        fill="none"
        stroke="var(--ink)"
        strokeOpacity="0.55"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      {[0, 2].map((i) => {
        const s = screen[i]!;
        const p = panel[i]!;
        return (
          <line
            key={i}
            x1={s.x}
            y1={s.y}
            x2={p.x}
            y2={p.y}
            stroke="var(--ink)"
            strokeOpacity="0.3"
            strokeWidth="1"
            strokeDasharray="4 5"
          />
        );
      })}
    </motion.svg>
  );
}
