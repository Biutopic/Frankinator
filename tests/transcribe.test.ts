import { describe, it, expect } from "vitest";
import { segmentsToCues, mergeChunkCues } from "@/lib/transcribe/segments";

describe("segments Whisper -> cues", () => {
  it("convertit des segments simples en cues numérotés", () => {
    const cues = segmentsToCues([
      { startMs: 0, endMs: 2000, text: " Bonjour à tous " },
      { startMs: 2100, endMs: 4000, text: "on se retrouve" },
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[0].id).toBe(1);
    expect(cues[0].correctedText).toBe("Bonjour à tous");
    expect(cues[0].originalText).toBe("Bonjour à tous");
    expect(cues[1].startMs).toBe(2100);
  });

  it("ignore les segments vides ou invalides", () => {
    const cues = segmentsToCues([
      { startMs: 0, endMs: 1000, text: "   " },
      { startMs: NaN, endMs: 2000, text: "invalide" },
      { startMs: 3000, endMs: 4000, text: "valide" },
    ]);
    expect(cues).toHaveLength(1);
    expect(cues[0].correctedText).toBe("valide");
  });

  it("impose une durée minimale et résout les chevauchements", () => {
    const cues = segmentsToCues([
      { startMs: 0, endMs: 100, text: "trop court" },
      { startMs: 200, endMs: 1500, text: "chevauche" },
    ]);
    expect(cues[0].endMs - cues[0].startMs).toBeGreaterThanOrEqual(300);
    expect(cues[1].startMs).toBeGreaterThanOrEqual(cues[0].endMs);
  });

  it("applique le décalage temporel des morceaux", () => {
    const cues = segmentsToCues([{ startMs: 1000, endMs: 2000, text: "suite" }], 240_000);
    expect(cues[0].startMs).toBe(241_000);
    expect(cues[0].endMs).toBe(242_000);
  });

  it("trie des segments désordonnés", () => {
    const cues = segmentsToCues([
      { startMs: 5000, endMs: 6000, text: "deux" },
      { startMs: 1000, endMs: 2000, text: "un" },
    ]);
    expect(cues.map((c) => c.correctedText)).toEqual(["un", "deux"]);
  });

  it("fusionne plusieurs morceaux en renumérotant", () => {
    const a = segmentsToCues([{ startMs: 0, endMs: 2000, text: "début" }], 0);
    const b = segmentsToCues([{ startMs: 0, endMs: 2000, text: "fin" }], 240_000);
    const merged = mergeChunkCues([a, b]);
    expect(merged.map((c) => c.id)).toEqual([1, 2]);
    expect(merged[1].startMs).toBe(240_000);
  });
});
