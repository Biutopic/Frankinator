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

  it("replie sur WebM sinon", () => {
    const choice = pickMimeType((m) => m.startsWith("video/webm"));
    expect(choice?.extension).toBe("webm");
  });

  it("null si rien n'est supporté", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
});
