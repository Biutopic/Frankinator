import { describe, it, expect } from "vitest";
import {
  segmentsToCues,
  mergeChunkCues,
  groupWords,
  splitSegmentProportionally,
  transcriptToCues,
  type TranscriptWord,
} from "@/lib/transcribe/segments";

function makeWords(text: string, startMs: number, wordMs = 300, gapMs = 50): TranscriptWord[] {
  let t = startMs;
  return text.split(/\s+/).map((w) => {
    const word = { text: w, startMs: t, endMs: t + wordMs };
    t += wordMs + gapMs;
    return word;
  });
}

describe("regroupement mot à mot (cues courts)", () => {
  it("coupe à la ponctuation forte", () => {
    const words = makeWords("On a fini le tournage. La suite arrive bientôt", 0);
    const groups = groupWords(words);
    expect(groups.length).toBe(2);
    expect(groups[0].text).toBe("On a fini le tournage.");
    expect(groups[1].text).toBe("La suite arrive bientôt");
  });

  it("ne produit jamais de cue au-delà de la longueur cible", () => {
    const long = "alors on va continuer à suivre l'évolution pour ces huit dauphins et puis on va demander des comptes sur les circonstances de ce transfert";
    const groups = groupWords(makeWords(long, 0));
    expect(groups.length).toBeGreaterThan(2);
    for (const g of groups) expect(g.text.length).toBeLessThanOrEqual(60);
  });

  it("coupe sur un silence long", () => {
    const a = makeWords("première partie", 0);
    const b = makeWords("deuxième partie", a[a.length - 1].endMs + 1500);
    const groups = groupWords([...a, ...b]);
    expect(groups.length).toBe(2);
    // Le cue se termine à la fin du dernier mot, pas au début du suivant.
    expect(groups[0].endMs).toBe(a[a.length - 1].endMs);
  });

  it("le timing vient des mots (exact)", () => {
    const words = makeWords("un deux trois", 1000);
    const groups = groupWords(words);
    expect(groups[0].startMs).toBe(1000);
    expect(groups[0].endMs).toBe(words[2].endMs);
  });
});

describe("découpage proportionnel (sans timestamps mot à mot)", () => {
  it("découpe un long segment en morceaux courts qui couvrent tout l'intervalle", () => {
    const seg = {
      startMs: 0,
      endMs: 12_000,
      text: "Alors on va continuer à suivre l'évolution pour ces huit dauphins, et puis on va demander des comptes sur les circonstances de ce transfert.",
    };
    const pieces = splitSegmentProportionally(seg);
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces[0].startMs).toBe(0);
    expect(pieces[pieces.length - 1].endMs).toBe(12_000);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].startMs).toBe(pieces[i - 1].endMs);
    expect(pieces.map((p) => p.text).join(" ")).toBe(seg.text);
  });

  it("laisse un segment court intact", () => {
    const seg = { startMs: 0, endMs: 2000, text: "Bonjour à tous" };
    expect(splitSegmentProportionally(seg)).toEqual([seg]);
  });
});

describe("transcriptToCues (bout en bout)", () => {
  it("préfère les mots quand ils existent, sinon découpe le segment", () => {
    const withWords = {
      startMs: 0,
      endMs: 3000,
      text: "phrase avec mots",
      words: makeWords("phrase avec mots", 0),
    };
    const withoutWords = {
      startMs: 5000,
      endMs: 17_000,
      text: "un très long segment sans timestamps mot à mot qui doit être découpé en plusieurs morceaux courts pour rester lisible à l'écran",
    };
    const cues = transcriptToCues([withWords, withoutWords]);
    expect(cues.length).toBeGreaterThan(3);
    for (const c of cues) expect(c.correctedText.length).toBeLessThanOrEqual(60);
    expect(cues.map((c) => c.id)).toEqual(cues.map((_, i) => i + 1));
  });
});

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
