import type { Cue } from "../types";
import { createCue } from "../types";

/**
 * Conversion des segments Whisper en cues Frankinator.
 * Logique pure (testée) : tri, durée minimale, chevauchements résolus,
 * segments vides ignorés, décalage temporel pour les morceaux d'audio.
 */

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

const MIN_CUE_MS = 300;

export function segmentsToCues(
  segments: TranscriptSegment[],
  offsetMs = 0,
  startId = 1
): Cue[] {
  const sorted = segments
    .filter((s) => s.text.trim() !== "" && Number.isFinite(s.startMs) && Number.isFinite(s.endMs))
    .map((s) => ({
      startMs: Math.max(0, Math.round(s.startMs + offsetMs)),
      endMs: Math.max(0, Math.round(s.endMs + offsetMs)),
      text: s.text.trim(),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  const cues: Cue[] = [];
  let id = startId;
  let prevEnd = -1;
  for (const s of sorted) {
    let start = s.startMs;
    let end = Math.max(s.endMs, start + MIN_CUE_MS);
    // Résout les chevauchements créés par Whisper : on colle au précédent.
    if (start < prevEnd) start = prevEnd;
    if (end <= start) end = start + MIN_CUE_MS;
    cues.push(createCue(id++, start, end, s.text));
    prevEnd = end;
  }
  return cues;
}

/** Fusionne les cues de plusieurs morceaux transcrits séquentiellement. */
export function mergeChunkCues(chunks: Cue[][]): Cue[] {
  const all = chunks.flat().sort((a, b) => a.startMs - b.startMs);
  return all.map((c, i) => ({ ...c, id: i + 1 }));
}
