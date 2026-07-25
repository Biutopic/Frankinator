import { describe, it, expect } from "vitest";
import { splitLongCue } from "@/lib/format/split";
import { breakIntoLines } from "@/lib/format/linebreak";
import { createFakeMeasurer } from "@/lib/format/measure";

const measurer = createFakeMeasurer({ fontFamily: "Test", fontWeight: 800, fontSizePx: 65, trackingEm: -0.04 });
const opts = { measurer, maxWidthPx: 888, maxLines: 2, minCueDurationMs: 600 };

const LONG_TEXT =
  "Ceci est une phrase beaucoup trop longue pour tenir sur deux lignes, elle doit donc être découpée en plusieurs sous-titres consécutifs qui préservent le sens et la durée totale de l'intervalle d'origine";

describe("découpage des cues trop longs", () => {
  it("découpe en plusieurs cues consécutifs valides (max 2 lignes chacun)", () => {
    const r = splitLongCue({ startMs: 10_000, endMs: 22_000, correctedText: LONG_TEXT }, opts);
    expect(r.ok).toBe(true);
    expect(r.pieces.length).toBeGreaterThan(1);
    for (const piece of r.pieces) {
      const lines = breakIntoLines(piece.text, opts);
      expect(lines.overflow).toBe(false);
      expect(lines.lines.length).toBeLessThanOrEqual(2);
    }
  });

  it("préserve l'intervalle global [début, fin]", () => {
    const r = splitLongCue({ startMs: 10_000, endMs: 22_000, correctedText: LONG_TEXT }, opts);
    expect(r.pieces[0].startMs).toBe(10_000);
    expect(r.pieces[r.pieces.length - 1].endMs).toBe(22_000);
  });

  it("ne crée ni trous ni chevauchements", () => {
    const r = splitLongCue({ startMs: 10_000, endMs: 22_000, correctedText: LONG_TEXT }, opts);
    for (let i = 1; i < r.pieces.length; i++) {
      expect(r.pieces[i].startMs).toBe(r.pieces[i - 1].endMs);
    }
  });

  it("préserve l'ordre des mots et le texte intégral", () => {
    const r = splitLongCue({ startMs: 10_000, endMs: 22_000, correctedText: LONG_TEXT }, opts);
    const joined = r.pieces.map((p) => p.text).join(" ").replace(/\s+/g, " ");
    expect(joined).toBe(LONG_TEXT.replace(/\s+/g, " "));
  });

  it("répartit le temps proportionnellement au texte", () => {
    const r = splitLongCue({ startMs: 0, endMs: 12_000, correctedText: LONG_TEXT }, opts);
    for (const p of r.pieces) {
      const share = (p.endMs - p.startMs) / 12_000;
      const charShare = p.text.length / LONG_TEXT.length;
      expect(Math.abs(share - charShare)).toBeLessThan(0.25);
    }
  });

  it("respecte la durée minimale configurable", () => {
    const r = splitLongCue({ startMs: 0, endMs: 12_000, correctedText: LONG_TEXT }, opts);
    for (const p of r.pieces) {
      expect(p.endMs - p.startMs).toBeGreaterThanOrEqual(599); // arrondi ms
    }
  });

  it("refuse de créer des cues illisibles : durée trop courte -> avertissement", () => {
    const r = splitLongCue({ startMs: 0, endMs: 900, correctedText: LONG_TEXT }, opts);
    expect(r.ok).toBe(false);
    expect(r.warning).toBeTruthy();
    // Le cue d'origine est conservé tel quel pour révision manuelle.
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].text).toBe(LONG_TEXT);
  });

  it("ne scinde pas les expressions protégées entre cues", () => {
    const text =
      "Nous arriverons vers 7 h 30 devant le grand bâtiment principal et ensuite nous irons visiter le laboratoire avec toute l'équipe de recherche au complet pour la journée";
    const r = splitLongCue({ startMs: 0, endMs: 10_000, correctedText: text }, opts);
    const holder = r.pieces.find((p) => p.text.includes("7"));
    expect(holder?.text).toContain("7 h 30");
  });

  it("un texte qui tient reste un seul cue", () => {
    const r = splitLongCue({ startMs: 0, endMs: 3000, correctedText: "Bonjour à tous" }, opts);
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].startMs).toBe(0);
    expect(r.pieces[0].endMs).toBe(3000);
  });
});
