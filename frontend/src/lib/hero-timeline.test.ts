import { describe, expect, it } from "vitest";
import { HERO_STAGES, SCENE_MOVE_DURATION, stageAt } from "./hero-timeline";

const at = (name: string) => HERO_STAGES.find((s) => s.name === name)?.at;

describe("hero timeline", () => {
  it("keeps the desk drawing large for the first 3 seconds", () => {
    expect(stageAt(2999)).toBe("intro");
    expect(at("shrink")).toBe(3000);
  });

  it("finishes the move before the screen lights up", () => {
    expect(3000 + SCENE_MOVE_DURATION * 1000).toBeLessThanOrEqual(at("glow")!);
  });

  it("opens the app window from the screen just after it lights", () => {
    expect(at("glow")).toBe(4100);
    expect(at("emerge")).toBe(4250);
  });

  it("starts the conversation once the window is open and shows evidence soon after", () => {
    expect(at("userMessage")).toBeGreaterThanOrEqual(at("emerge")! + 1000);
    expect(at("verified")! - at("userMessage")!).toBeLessThanOrEqual(3000);
  });
});
