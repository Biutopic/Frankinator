import type { Cue } from "../types";
import { formatTimecode } from "./timecode";

/**
 * Sérialisation SRT.
 * - renumérotation séquentielle à partir de 1
 * - millisecondes avec virgule
 * - texte = formattedLines si présent, sinon correctedText
 */
export function serializeSrt(cues: Cue[], opts?: { useFormattedLines?: boolean }): string {
  const useLines = opts?.useFormattedLines ?? false;
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs || a.id - b.id);
  return sorted
    .map((cue, i) => {
      const text =
        useLines && cue.formattedLines.length > 0
          ? cue.formattedLines.join("\n")
          : cue.correctedText;
      return `${i + 1}\n${formatTimecode(cue.startMs)} --> ${formatTimecode(cue.endMs)}\n${text}`;
    })
    .join("\n\n") + "\n";
}

/** Transcript texte brut (une phrase par cue, sans timing). */
export function serializeTranscript(cues: Cue[]): string {
  return (
    [...cues]
      .sort((a, b) => a.startMs - b.startMs)
      .map((c) => c.correctedText.replace(/\n/g, " "))
      .join("\n") + "\n"
  );
}
