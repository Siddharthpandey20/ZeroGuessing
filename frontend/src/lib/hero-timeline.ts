import { useEffect, useState } from "react";

/**
 * Ordered stages of the hero sequence. Each stage starts at the given
 * millisecond offset after the page loads.
 */
export const HERO_STAGES = [
  { name: "intro", at: 0 },
  { name: "shrink", at: 3000 },
  { name: "glow", at: 4100 },
  { name: "emerge", at: 4250 },
  { name: "userMessage", at: 5500 },
  { name: "typing", at: 6000 },
  { name: "answer", at: 6600 },
  { name: "evidence", at: 7300 },
  { name: "verified", at: 7900 },
  { name: "contradiction", at: 8500 },
] as const;

export type HeroStageName = (typeof HERO_STAGES)[number]["name"];

/** Duration (s) of the drawing's move to its small slot; ends as the screen lights at 4.1s. */
export const SCENE_MOVE_DURATION = 1.1;
export const PANEL_EMERGE_DURATION = 1.05;
export const CINEMATIC_EASE = [0.76, 0, 0.24, 1] as const;
export const SOFT_EASE = [0.22, 1, 0.36, 1] as const;

export function stageIndex(name: HeroStageName): number {
  return HERO_STAGES.findIndex((s) => s.name === name);
}

export function stageAt(elapsedMs: number): HeroStageName {
  let current: HeroStageName = "intro";
  for (const s of HERO_STAGES) if (elapsedMs >= s.at) current = s.name;
  return current;
}

/**
 * Drives the one-shot hero sequence. Runs once per page load (never loops);
 * reduced-motion users jump straight to the final state.
 */
export function useHeroTimeline(reducedMotion: boolean) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      setStage(HERO_STAGES.length - 1);
      return;
    }
    const timers = HERO_STAGES.slice(1).map((s, i) =>
      window.setTimeout(() => setStage(i + 1), s.at),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reducedMotion]);

  return {
    stage,
    reached: (name: HeroStageName) => stage >= stageIndex(name),
  };
}
