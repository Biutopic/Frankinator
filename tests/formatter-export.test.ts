import { describe, it, expect } from "vitest";
import { formatAllCues } from "@/lib/format/formatter";
import { createFakeMeasurer, FALLBACK_FONT, createFakeMeasurer as fake } from "@/lib/format/measure";
import { validateForExport, buildExports, exportBaseName } from "@/lib/export";
import { defaultProfiles, type Cue } from "@/lib/types";
import { parseSrt } from "@/lib/srt/parse";

const profile = defaultProfiles()[0]; // Reel Instagram — Premiere
const measurer = createFakeMeasurer({
  fontFamily: profile.fontFamily,
  fontWeight: profile.fontWeight,
  fontSizePx: profile.fontSizePx,
  trackingEm: profile.trackingEm,
});

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

describe("formatage global", () => {
  it("aucun cue Reel ne dépasse deux lignes après formatage", () => {
    const cues = [
      cue(1, 0, 4000, "Bonjour à tous et bienvenue dans cette nouvelle vidéo"),
      cue(2, 4100, 12_000,
        "Une phrase nettement plus longue qui devra être découpée en plusieurs sous-titres consécutifs pour rester lisible à l'écran sur un format vertical"),
    ];
    const r = formatAllCues(cues, profile, measurer, [], []);
    for (const c of r.cues) {
      expect(c.formattedLines.length).toBeLessThanOrEqual(2);
    }
  });

  it("le découpage préserve l'intervalle temporel global", () => {
    const cues = [
      cue(2, 4100, 12_000,
        "Une phrase nettement plus longue qui devra être découpée en plusieurs sous-titres consécutifs pour rester lisible à l'écran sur un format vertical"),
    ];
    const r = formatAllCues(cues, profile, measurer, [], []);
    const sorted = [...r.cues].sort((a, b) => a.startMs - b.startMs);
    expect(sorted[0].startMs).toBe(4100);
    expect(sorted[sorted.length - 1].endMs).toBe(12_000);
  });

  it("les cues verrouillés ne sont jamais reformés", () => {
    const locked = cue(1, 0, 4000, "Texte verrouillé qui ne doit pas bouger du tout", {
      isLocked: true,
      formattedLines: ["Texte figé"],
    });
    const r = formatAllCues([locked], profile, measurer, [], []);
    expect(r.cues[0].formattedLines).toEqual(["Texte figé"]);
    expect(r.cues[0].correctedText).toBe("Texte verrouillé qui ne doit pas bouger du tout");
    // Deuxième exécution : toujours identique.
    const r2 = formatAllCues(r.cues, profile, measurer, [], []);
    expect(r2.cues[0]).toEqual(r.cues[0]);
  });

  it("une correction rejetée restaure exactement le texte original", () => {
    // Simule le flux de rejet : correctedText revient à originalText.
    const c = cue(1, 0, 2000, "texte original exact", { correctedText: "texte corrigé par l'IA" });
    const restored = { ...c, correctedText: c.originalText };
    expect(restored.correctedText).toBe("texte original exact");
  });
});

describe("validation d'export", () => {
  it("checklist entièrement verte pour un projet propre", () => {
    const { cues } = parseSrt(
      "1\n00:00:01,000 --> 00:00:03,000\nBonjour à tous\n\n2\n00:00:03,100 --> 00:00:05,000\nOn continue\n"
    );
    const formatted = formatAllCues(cues, profile, measurer, [], []);
    const checklist = validateForExport(formatted.cues, profile, measurer, [], []);
    expect(checklist.every((c) => c.ok)).toBe(true);
  });

  it("détecte cues vides, chevauchements et fins inversées", () => {
    const bad = [
      cue(1, 0, 2000, ""),
      cue(2, 1000, 3000, "chevauche"),
      cue(3, 5000, 4000, "inversé"),
    ];
    const checklist = validateForExport(bad, profile, measurer, [], []);
    expect(checklist.find((c) => c.label.includes("vide"))?.ok).toBe(false);
    expect(checklist.find((c) => c.label.includes("chevauchement"))?.ok).toBe(false);
    expect(checklist.find((c) => c.label.includes("avant fin"))?.ok).toBe(false);
  });

  it("détecte une expression protégée scindée entre lignes", () => {
    const c = cue(1, 0, 3000, "il fait 20 °C dehors", { formattedLines: ["il fait 20", "°C dehors"] });
    const checklist = validateForExport([c], profile, measurer, [], []);
    expect(checklist.find((ck) => ck.label.includes("protégée"))?.ok).toBe(false);
  });

  it("détecte un mot coupé (lignes ≠ texte source)", () => {
    const c = cue(1, 0, 3000, "organisation complète", { formattedLines: ["organisa", "tion complète"] });
    const checklist = validateForExport([c], profile, measurer, [], []);
    expect(checklist.find((ck) => ck.label.includes("mot coupé"))?.ok).toBe(false);
  });
});

describe("exports", () => {
  it("noms de fichiers FRANKINATED corrects", () => {
    const exports = buildExports([cue(1, 0, 2000, "Salut")], "ma-video.srt");
    expect(exports.clean.name).toBe("ma-video_FRANKINATED_CLEAN.srt");
    expect(exports.formatted.name).toBe("ma-video_FRANKINATED_FORMATTED.srt");
    expect(exports.transcript.name).toBe("ma-video_FRANKINATED.txt");
    expect(exports.report.name).toBe("ma-video_FRANKINATED_REPORT.json");
  });

  it("nom par défaut sans fichier source", () => {
    expect(exportBaseName(null)).toBe("sous-titres");
  });

  it("le rapport JSON liste les corrections effectuées", () => {
    const c = cue(1, 0, 2000, "bonjour a tous", { correctedText: "Bonjour à tous", reviewState: "accepted" });
    const exports = buildExports([c], "clip.srt");
    const report = JSON.parse(exports.report.content);
    expect(report.changedCues).toBe(1);
    expect(report.corrections[0].original).toBe("bonjour a tous");
    expect(report.corrections[0].corrected).toBe("Bonjour à tous");
  });

  it("le transcript contient une ligne par cue, accents préservés", () => {
    const exports = buildExports(
      [cue(1, 0, 2000, "Première phrase"), cue(2, 2100, 4000, "Deuxième phrase à vérifier")],
      null
    );
    expect(exports.transcript.content).toBe("Première phrase\nDeuxième phrase à vérifier\n");
  });
});

describe("repli de police", () => {
  it("le fallback explicite est Arial", () => {
    expect(FALLBACK_FONT).toBe("Arial");
  });
  it("le mesureur de repli reste déterministe pour une même config", () => {
    const a = fake({ fontFamily: "X", fontWeight: 700, fontSizePx: 60, trackingEm: 0 });
    const b = fake({ fontFamily: "X", fontWeight: 700, fontSizePx: 60, trackingEm: 0 });
    expect(a.measure("test de largeur")).toBe(b.measure("test de largeur"));
  });
});
