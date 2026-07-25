import { describe, it, expect } from "vitest";
import { applyRecommendations } from "@/lib/format/formatter";
import { createFakeMeasurer } from "@/lib/format/measure";
import { defaultProfiles, type Cue } from "@/lib/types";

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

describe("appliquer les recommandations (fusion auto encadrée)", () => {
  it("fusionne un cue orphelin (mot faible) avec son voisin", () => {
    const cues = [
      cue(1, 0, 500, "et"), // orphelin, trop court
      cue(2, 550, 2500, "on continue le suivi"),
    ];
    const r = applyRecommendations(cues, profile, measurer, [], []);
    expect(r.mergesApplied).toBe(1);
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0].correctedText).toBe("et on continue le suivi");
    expect(r.cues[0].startMs).toBe(0);
    expect(r.cues[0].endMs).toBe(2500);
  });

  it("fusionne un cue trop rapide quand la fusion reste lisible", () => {
    const cues = [
      cue(1, 0, 600, "voilà le résultat"), // ~28 car/s -> trop rapide
      cue(2, 650, 3400, "de l'audience"),
    ];
    const r = applyRecommendations(cues, profile, measurer, [], []);
    expect(r.mergesApplied).toBe(1);
  });

  it("ne fusionne jamais au-delà du seuil d'écart", () => {
    const cues = [
      cue(1, 0, 500, "et"),
      cue(2, 1000, 3000, "on continue le suivi"), // écart 500 ms > 120 ms
    ];
    const r = applyRecommendations(cues, profile, measurer, [], []);
    expect(r.mergesApplied).toBe(0);
    expect(r.cues).toHaveLength(2);
  });

  it("ne fusionne pas des cues sans problème signalé", () => {
    const cues = [
      cue(1, 0, 2000, "une phrase tranquille"),
      cue(2, 2050, 4000, "une autre phrase calme"),
    ];
    const r = applyRecommendations(cues, profile, measurer, [], []);
    expect(r.mergesApplied).toBe(0);
  });

  it("ne touche jamais aux cues verrouillés", () => {
    const cues = [
      cue(1, 0, 500, "et", { isLocked: true }),
      cue(2, 550, 2500, "on continue le suivi"),
    ];
    const r = applyRecommendations(cues, profile, measurer, [], []);
    expect(r.mergesApplied).toBe(0);
    expect(r.cues.find((c) => c.id === 1)?.correctedText).toBe("et");
  });

  it("refuse une fusion qui recréerait un dépassement, et reformate le reste", () => {
    const long = "une très longue phrase qui occupe déjà toute la largeur disponible sur les deux lignes autorisées du profil vertical";
    const cues = [
      cue(1, 0, 400, "vite"), // trop court
      cue(2, 450, 6000, long),
    ];
    const r = applyRecommendations(cues, profile, measurer, [], []);
    // La fusion est rejetée (combiné trop large) mais le formatage passe.
    for (const c of r.cues) expect(c.formattedLines.length).toBeLessThanOrEqual(2);
  });
});
