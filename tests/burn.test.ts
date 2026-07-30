import { describe, it, expect } from "vitest";
import { cueAt, pickMimeType } from "@/lib/burn";
import { createCue } from "@/lib/types";

describe("incrustation : cue actif à un instant donné", () => {
  const cues = [createCue(1, 0, 2000, "un"), createCue(2, 2500, 4000, "deux")];

  it("trouve le cue couvrant l'instant", () => {
    expect(cueAt(cues, 1000)?.correctedText).toBe("un");
    expect(cueAt(cues, 3000)?.correctedText).toBe("deux");
  });

  it("renvoie null dans les silences et après la fin", () => {
    expect(cueAt(cues, 2200)).toBeNull();
    expect(cueAt(cues, 9000)).toBeNull();
  });

  it("bornes : début inclus, fin exclue", () => {
    expect(cueAt(cues, 0)?.id).toBe(1);
    expect(cueAt(cues, 2000)).toBeNull();
  });
});

describe("incrustation : choix du format d'enregistrement", () => {
  it("préfère le MP4 quand il est supporté", () => {
    const choice = pickMimeType(() => true);
    expect(choice?.extension).toBe("mp4");
  });

  it("MP4 uniquement par défaut : pas de repli WebM silencieux", () => {
    expect(pickMimeType((m) => m.startsWith("video/webm"))).toBeNull();
  });

  it("WebM disponible seulement en repli explicite", () => {
    const choice = pickMimeType((m) => m.startsWith("video/webm"), { mp4Only: false });
    expect(choice?.extension).toBe("webm");
  });

  it("null si rien n'est supporté", () => {
    expect(pickMimeType(() => false, { mp4Only: false })).toBeNull();
  });
});

describe("incrustation : débit vidéo adaptatif", async () => {
  const { videoBitrate } = await import("@/lib/burn");

  it("monte avec la résolution, borné entre 8 et 20 Mbit/s", () => {
    expect(videoBitrate(640, 360)).toBe(8_000_000); // plancher
    expect(videoBitrate(1080, 1920)).toBeGreaterThan(10_000_000);
    expect(videoBitrate(3840, 2160)).toBe(20_000_000); // plafond
  });
});
