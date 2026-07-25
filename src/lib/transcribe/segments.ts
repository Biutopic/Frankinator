import type { Cue } from "../types";
import { createCue } from "../types";
import { isWeakWord } from "../text/weakWords";

/**
 * Conversion de la transcription Whisper en cues Frankinator.
 *
 * Whisper renvoie des segments de phrases entières (10-15 s) : trop longs
 * pour des sous-titres. Quand les timestamps mot à mot sont disponibles,
 * on regroupe les mots en cues courts (coupés à la ponctuation, aux
 * silences et à une longueur cible) avec un timing exact. Sinon, on
 * découpe le segment proportionnellement au texte.
 */

export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  words?: TranscriptWord[];
}

const MIN_CUE_MS = 300;
/** Longueur cible d'un cue (≈ 1-2 lignes en vertical). */
const TARGET_MAX_CHARS = 42;
/** Durée max d'un cue généré. */
const TARGET_MAX_MS = 4000;
/** Un silence plus long que ceci coupe le cue. */
const GAP_BREAK_MS = 700;

const STRONG_PUNCT = /[.!?…]$/;
const SOFT_PUNCT = /[,;:]$/;

/**
 * Recolle les élisions que Whisper sépare (« l » + « 'évolution » ->
 * « l'évolution », « qu » + « 'on » -> « qu'on »).
 */
export function normalizeWords(words: TranscriptWord[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && /^['’]/.test(w.text)) {
      prev.text += w.text;
      prev.endMs = w.endMs;
      continue;
    }
    if (prev && /['’]$/.test(prev.text)) {
      prev.text += w.text;
      prev.endMs = w.endMs;
      continue;
    }
    out.push({ ...w });
  }
  return out;
}

/** Regroupe des mots horodatés en petits segments de sous-titre. */
export function groupWords(rawWords: TranscriptWord[]): TranscriptSegment[] {
  const words = normalizeWords(rawWords);
  const groups: TranscriptSegment[] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    groups.push({
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      text: current.map((w) => w.text).join(" "),
    });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    current.push(w);
    const next = words[i + 1];
    const text = current.map((x) => x.text).join(" ");
    const durMs = w.endMs - current[0].startMs;

    const strong = STRONG_PUNCT.test(w.text);
    const soft = SOFT_PUNCT.test(w.text) && text.length >= TARGET_MAX_CHARS * 0.6;
    const silence = next !== undefined && next.startMs - w.endMs > GAP_BREAK_MS;
    let tooLong =
      next !== undefined &&
      (text.length + 1 + next.text.length > TARGET_MAX_CHARS || durMs + (next.endMs - next.startMs) > TARGET_MAX_MS);
    // Éviter de finir un cue sur un mot faible (« et », « de », « les »…) :
    // on tolère un léger dépassement pour emporter le mot suivant.
    if (tooLong && !strong && !silence && isWeakWord(w.text) && text.length < TARGET_MAX_CHARS + 12) {
      tooLong = false;
    }

    if (strong || soft || silence || tooLong) flush();
  }
  flush();
  return groups;
}

/** Découpe proportionnelle d'un segment sans timestamps mot à mot. */
export function splitSegmentProportionally(seg: TranscriptSegment): TranscriptSegment[] {
  const text = seg.text.trim();
  if (text.length <= TARGET_MAX_CHARS) return [seg];

  // Découpe en propositions (ponctuation), puis re-scinde les trop longues.
  const clauses = text
    .split(/(?<=[.!?…,;:])\s+/)
    .flatMap((clause) => {
      if (clause.length <= TARGET_MAX_CHARS) return [clause];
      const out: string[] = [];
      let cur = "";
      for (const word of clause.split(/\s+/)) {
        if (cur !== "" && cur.length + 1 + word.length > TARGET_MAX_CHARS) {
          out.push(cur);
          cur = word;
        } else {
          cur = cur === "" ? word : `${cur} ${word}`;
        }
      }
      if (cur !== "") out.push(cur);
      return out;
    })
    .filter((c) => c.trim() !== "");

  // Regroupe les propositions courtes pour ne pas produire de miettes.
  const pieces: string[] = [];
  for (const clause of clauses) {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.length + 1 + clause.length <= TARGET_MAX_CHARS) {
      pieces[pieces.length - 1] = `${last} ${clause}`;
    } else {
      pieces.push(clause);
    }
  }

  // Temps réparti proportionnellement au nombre de caractères.
  const total = seg.endMs - seg.startMs;
  const sumChars = pieces.reduce((a, p) => a + p.length, 0);
  const out: TranscriptSegment[] = [];
  let t = seg.startMs;
  let acc = 0;
  pieces.forEach((p, i) => {
    acc += p.length;
    const end = i === pieces.length - 1 ? seg.endMs : Math.round(seg.startMs + (acc / sumChars) * total);
    out.push({ startMs: Math.round(t), endMs: end, text: p });
    t = end;
  });
  return out;
}

/** Normalisation finale : tri, durée minimale, chevauchements, ids. */
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
    if (start < prevEnd) start = prevEnd;
    if (end <= start) end = start + MIN_CUE_MS;
    cues.push(createCue(id++, start, end, s.text));
    prevEnd = end;
  }
  return cues;
}

/**
 * Point d'entrée : segments Whisper (avec ou sans mots) -> cues courts.
 */
export function transcriptToCues(
  segments: TranscriptSegment[],
  offsetMs = 0,
  startId = 1
): Cue[] {
  const pieces: TranscriptSegment[] = [];
  for (const seg of segments) {
    if (seg.words && seg.words.length > 0) {
      pieces.push(...groupWords(seg.words));
    } else {
      pieces.push(...splitSegmentProportionally(seg));
    }
  }
  return segmentsToCues(pieces, offsetMs, startId);
}

/** Fusionne les cues de plusieurs morceaux transcrits séquentiellement. */
export function mergeChunkCues(chunks: Cue[][]): Cue[] {
  const all = chunks.flat().sort((a, b) => a.startMs - b.startMs);
  return all.map((c, i) => ({ ...c, id: i + 1 }));
}
