import { describe, it, expect } from "vitest";
import { canMerge, mergeCues } from "@/lib/format/merge";
import { readingStats, orphanIssue } from "@/lib/format/readingSpeed";
import { createFakeMeasurer } from "@/lib/format/measure";
import { DEFAULT_WEAK_WORDS, isWeakWord } from "@/lib/text/weakWords";
import type { Cue } from "@/lib/types";

const measurer = createFakeMeasurer({ fontFamily: "Test", fontWeight: 700, fontSizePx: 60, trackingEm: 0 });
const mergeOpts = {
  measurer,
  maxWidthPx: 888,
  maxLines: 2,
  maxMergeGapMs: 120,
  maxCharsPerSecond: 20,
};

function cue(id: number, startMs: number, endMs: number, text: string, patch: Partial<Cue> = {}): Cue {
  return {
    id,
    startMs,
    endMs,
    originalText: text,
    correctedText: text,
    formattedLines: [],
    isLocked: false,
    warnings: [],
    originalStartMs: startMs,
    originalEndMs: endMs,
    reviewState: "untouched",
    proposedText: null,
    proposedConfidence: null,
    splitFrom: null,
    ...patch,
  };
}

describe("fusion optionnelle de cues", () => {
  it("accepte une fusion valide sous le seuil d'écart", () => {
    const a = cue(1, 0, 2000, "on a commencé");
    const b = cue(2, 2100, 4000, "le tournage hier");
    expect(canMerge(a, b, mergeOpts).ok).toBe(true);
  });

  it("refuse au-delà du seuil configurable (120 ms par défaut)", () => {
    const a = cue(1, 0, 2000, "on a commencé");
    const b = cue(2, 2200, 4000, "le tournage hier");
    expect(canMerge(a, b, mergeOpts).ok).toBe(false);
  });

  it("refuse si le texte combiné ne tient pas dans le profil", () => {
    const a = cue(1, 0, 2000, "une très longue première phrase qui occupe déjà toute la place disponible sur les deux lignes");
    const b = cue(2, 2050, 4000, "et une seconde phrase tout aussi interminable qui rendrait le bloc totalement illisible");
    expect(canMerge(a, b, mergeOpts).ok).toBe(false);
  });

  it("refuse si la vitesse de lecture explose", () => {
    const a = cue(1, 0, 400, "une phrase assez dense avec pas mal de texte");
    const b = cue(2, 450, 800, "et encore beaucoup de texte supplémentaire ici");
    expect(canMerge(a, b, mergeOpts).ok).toBe(false);
  });

  it("refuse un changement de locuteur (tiret de dialogue)", () => {
    const a = cue(1, 0, 2000, "et je lui ai dit");
    const b = cue(2, 2050, 4000, "- Pas question !");
    expect(canMerge(a, b, mergeOpts).ok).toBe(false);
  });

  it("refuse un cue verrouillé", () => {
    const a = cue(1, 0, 2000, "on continue", { isLocked: true });
    const b = cue(2, 2050, 4000, "comme prévu");
    expect(canMerge(a, b, mergeOpts).ok).toBe(false);
  });

  it("mergeCues concatène textes et timing englobant", () => {
    const a = cue(1, 0, 2000, "on a commencé");
    const b = cue(2, 2100, 4000, "le tournage hier");
    const m = mergeCues(a, b);
    expect(m.correctedText).toBe("on a commencé le tournage hier");
    expect(m.startMs).toBe(0);
    expect(m.endMs).toBe(4000);
  });
});

describe("vitesse de lecture", () => {
  it("calcule durée, caractères, mots, car./s et mots/min", () => {
    const c = cue(1, 0, 2000, "quatre mots par exemple");
    const stats = readingStats(c, measurer, 888);
    expect(stats.durationMs).toBe(2000);
    expect(stats.wordCount).toBe(4);
    expect(stats.charCount).toBe("quatre mots par exemple".length);
    expect(stats.charsPerSecond).toBeCloseTo(stats.charCount / 2, 1);
    expect(stats.wordsPerMinute).toBeCloseTo(120, 0);
  });

  it("mesure la largeur max rendue et le % de largeur utilisée", () => {
    const c = cue(1, 0, 2000, "ligne un\nligne deux", { formattedLines: ["ligne un", "ligne deux plus large"] });
    const stats = readingStats(c, measurer, 888);
    expect(stats.lineCount).toBe(2);
    expect(stats.maxLineWidthPx).toBe(measurer.measure("ligne deux plus large"));
    expect(stats.widthUsagePercent).toBeGreaterThan(0);
  });
});

describe("cues orphelins et mots faibles", () => {
  it("liste de mots faibles configurable", () => {
    expect(isWeakWord("le")).toBe(true);
    expect(isWeakWord("La")).toBe(true);
    expect(isWeakWord("baleine")).toBe(false);
    expect(isWeakWord("zorg", ["zorg"])).toBe(true);
  });

  it("signale un cue réduit à un mot faible", () => {
    expect(orphanIssue("et", DEFAULT_WEAK_WORDS)).toBeTruthy();
    expect(orphanIssue("dans", DEFAULT_WEAK_WORDS)).toBeTruthy();
  });

  it("signale un fragment de mots faibles", () => {
    expect(orphanIssue("et le", DEFAULT_WEAK_WORDS)).toBeTruthy();
  });

  it("ne signale pas une phrase normale", () => {
    expect(orphanIssue("la mer monte vite", DEFAULT_WEAK_WORDS)).toBeNull();
  });
});
