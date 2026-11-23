import { describe, expect, it } from "vitest";
import {
  CHAT_SCRIPT,
  HOLD_MS,
  TURN_OFFSETS,
  graphemes,
  scriptTurn,
  turnDuration,
  turnStateAt,
} from "./chat-script";

const first = CHAT_SCRIPT[0]!;
const second = CHAT_SCRIPT[1]!;

describe("demo chat loop", () => {
  it("opens with the amended prepayment rule and its chain of changes", () => {
    expect(first.answer).toContain("Nil");
    expect(first.note?.tone).toBe("chain");
  });

  it("sends the first question immediately, in step with the hero sequence", () => {
    expect(turnStateAt(first, 0, true).sent).toBe(true);
    expect(turnStateAt(first, TURN_OFFSETS.thinking, true).thinking).toBe(true);
    expect(turnStateAt(first, TURN_OFFSETS.answer, true).words).toBeGreaterThan(0);
    expect(turnStateAt(first, TURN_OFFSETS.evidence - 1, true).evidence).toBe(false);
    expect(turnStateAt(first, TURN_OFFSETS.evidence, true).evidence).toBe(true);
    expect(turnStateAt(first, TURN_OFFSETS.note, true).note).toBe(true);
  });

  it("types later questions in the composer before sending them", () => {
    const mid = turnStateAt(second, 300, false);
    expect(mid.sent).toBe(false);
    expect(mid.typedChars).toBeGreaterThan(0);
    expect(mid.typedChars).toBeLessThan(second.question.length);
    const { sent } = turnDuration(second, false);
    expect(turnStateAt(second, sent, false).sent).toBe(true);
  });

  it("keeps running: after the last conversation it starts again from the first", () => {
    expect(scriptTurn(CHAT_SCRIPT.length)).toBe(first);
    expect(scriptTurn(CHAT_SCRIPT.length + 1)).toBe(second);
  });

  it("holds each finished answer on screen before the next question", () => {
    const { end } = turnDuration(first, true);
    expect(end - TURN_OFFSETS.note).toBe(HOLD_MS);
  });

  it("covers a refusal, a contradiction and a Hindi question", () => {
    expect(CHAT_SCRIPT.some((t) => t.evidence === null)).toBe(true);
    expect(CHAT_SCRIPT.some((t) => t.note?.tone === "conflict")).toBe(true);
    expect(CHAT_SCRIPT.some((t) => /[ऀ-ॿ]/.test(t.question))).toBe(true);
  });

  it("types Devanagari by whole letters, never splitting a vowel sign from its consonant", () => {
    expect(graphemes("की")).toEqual(["की"]);
  });
});
