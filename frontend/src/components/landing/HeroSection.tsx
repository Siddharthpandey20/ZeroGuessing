import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useHeroTimeline } from "@/lib/hero-timeline";
import { Navbar } from "./Navbar";
import { HeroContent } from "./HeroContent";
import { PersonComputerScene, SCREEN_QUAD } from "./PersonComputerScene";
import { FloatingChatInterface, type PanelOrigin } from "./FloatingChatInterface";
import { ProjectionBeam, type Pt } from "./ProjectionBeam";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Layout box of `el` relative to `root`, ignoring transforms. */
function boxIn(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

type Geometry = { screen: Pt[]; panel: Pt[]; origin: PanelOrigin };

export function HeroSection() {
  const reduced = useReducedMotion();
  const instant = reduced === true;
  const { reached } = useHeroTimeline(instant);

  const heroRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geometry | null>(null);

  const moved = reached("shrink");

  const measure = useCallback(() => {
    const hero = heroRef.current;
    const scene = sceneRef.current;
    const panel = panelRef.current;
    if (!hero || !scene || !panel) return;
    const s = boxIn(scene, hero);
    const p = boxIn(panel, hero);
    const screen = SCREEN_QUAD.map(([fx, fy]) => ({ x: s.x + fx * s.w, y: s.y + fy * s.h }));
    const panelPts = [
      { x: p.x, y: p.y },
      { x: p.x + p.w, y: p.y },
      { x: p.x + p.w, y: p.y + p.h },
      { x: p.x, y: p.y + p.h },
    ];
    const cx = screen.reduce((a, q) => a + q.x, 0) / 4;
    const cy = screen.reduce((a, q) => a + q.y, 0) / 4;
    const screenW = (screen[1]!.x - screen[0]!.x + (screen[2]!.x - screen[3]!.x)) / 2;
    setGeo({
      screen,
      panel: panelPts,
      origin: {
        dx: cx - (p.x + p.w / 2),
        dy: cy - (p.y + p.h / 2),
        scale: Math.max(0.08, screenW / p.w),
      },
    });
  }, []);

  useIsoLayoutEffect(() => {
    measure();
  }, [moved, measure]);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(hero);
    return () => ro.disconnect();
  }, [measure]);

  const emerged = reached("emerge");

  return (
    <section ref={heroRef} className="hero-frame bg-paper">
      <Navbar />

      <div className="flex flex-col gap-12 px-6 pb-16 pt-28 md:px-10 lg:contents">
        <div className="hero-copy-slot z-30">
          <HeroContent />
        </div>

        <PersonComputerScene
          ref={sceneRef}
          moved={moved}
          glowing={reached("glow")}
          instant={instant}
        />

        <FloatingChatInterface
          ref={panelRef}
          reached={reached}
          origin={geo?.origin ?? null}
          instant={instant}
        />
      </div>

      {geo && (
        <ProjectionBeam screen={geo.screen} panel={geo.panel} visible={emerged} instant={instant} />
      )}
    </section>
  );
}
