import type { Cue } from "../types";
import type { BreakOptions } from "./linebreak";
import { breakIntoLines } from "./linebreak";
import { detectProtectedRanges, breakSplitsProtected } from "../text/protected";
import { tokenize } from "../text/tokenize";
import { isWeakWord } from "../text/weakWords";

/**
 * Découpage d'un cue trop long en plusieurs cues consécutifs.
 * - points de coupe sémantiques (ponctuation > frontières naturelles)
 * - expressions protégées respectées
 * - ordre des mots et sens préservés
 * - temps réparti proportionnellement au texte (pondération ponctuation)
 * - intervalle global [start, end] du cue d'origine préservé
 */

export interface SplitOptions extends BreakOptions {
  minCueDurationMs: number;
}

export interface SplitResult {
  /** Segments de texte, dans l'ordre. */
  pieces: { text: string; startMs: number; endMs: number }[];
  ok: boolean;
  warning: string | null;
}

/** Poids d'un segment pour la répartition du temps : caractères + pauses. */
function segmentWeight(text: string): number {
  let w = text.replace(/\s+/g, " ").trim().length;
  // Une ponctuation forte en fin de segment = respiration -> un peu plus de temps.
  if (/[.!?…]$/u.test(text.trim())) w += 8;
  else if (/[,;:]$/u.test(text.trim())) w += 4;
  return Math.max(w, 1);
}

/** Score d'un point de coupe entre cues (sémantique). */
function cueBreakScore(text: string, pos: number, opts: SplitOptions): number {
  const before = text.slice(0, pos).trimEnd();
  const after = text.slice(pos).trimStart();
  if (!before || !after) return -Infinity;
  let score = 0;
  if (/[.!?…]$/u.test(before)) score += 60;
  else if (/[,;:]$/u.test(before)) score += 35;
  const lastW = before.match(/[\p{L}\p{N}'’-]+$/u)?.[0] ?? "";
  if (isWeakWord(lastW, opts.weakWords)) score -= 40;
  const firstW = after.match(/^[\p{L}\p{N}'’-]+/u)?.[0] ?? "";
  if (isWeakWord(firstW, opts.weakWords) && after.split(/\s+/).length <= 2) score -= 25;
  return score;
}

/** Le segment tient-il dans maxLines lignes ? */
function fits(text: string, opts: SplitOptions): boolean {
  return !breakIntoLines(text, opts).overflow;
}

/**
 * Trouve récursivement une partition du texte en segments qui tiennent tous,
 * en privilégiant les meilleures coupes sémantiques et le moins de segments.
 */
function partition(text: string, opts: SplitOptions, depth = 0): string[] | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (fits(clean, opts)) return [clean];
  if (depth > 6) return null; // garde-fou

  const ranges = detectProtectedRanges(clean, opts.customProtected ?? [], opts.glossary ?? []);
  const tokens = tokenize(clean);
  const positions: number[] = [];
  for (const t of tokens) {
    if (t.kind !== "space") continue;
    const pos = t.start + t.text.length;
    if (pos <= 0 || pos >= clean.length) continue;
    if (breakSplitsProtected(pos, ranges)) continue;
    positions.push(pos);
  }
  if (positions.length === 0) return null;

  // Coupes triées par score sémantique, à proximité du milieu à score égal.
  const mid = clean.length / 2;
  const sorted = positions
    .map((pos) => ({ pos, score: cueBreakScore(clean, pos, opts) - Math.abs(pos - mid) / clean.length }))
    .sort((a, b) => b.score - a.score);

  for (const { pos } of sorted.slice(0, 8)) {
    const left = clean.slice(0, pos).trimEnd();
    const right = clean.slice(pos).trimStart();
    // La partie gauche doit tenir telle quelle (segments consécutifs).
    if (!fits(left, opts)) continue;
    const rest = partition(right, opts, depth + 1);
    if (rest) return [left, ...rest];
  }
  // Repli : première coupe dont la gauche tient, même score faible.
  for (const { pos } of sorted) {
    const left = clean.slice(0, pos).trimEnd();
    if (!fits(left, opts)) continue;
    const rest = partition(clean.slice(pos).trimStart(), opts, depth + 1);
    if (rest) return [left, ...rest];
  }
  return null;
}

export function splitLongCue(cue: Pick<Cue, "startMs" | "endMs" | "correctedText">, opts: SplitOptions): SplitResult {
  const total = cue.endMs - cue.startMs;
  const pieces = partition(cue.correctedText, opts);

  if (!pieces) {
    return {
      pieces: [{ text: cue.correctedText, startMs: cue.startMs, endMs: cue.endMs }],
      ok: false,
      warning: "Aucun découpage valide trouvé : révision manuelle nécessaire.",
    };
  }
  if (pieces.length === 1) {
    return { pieces: [{ text: pieces[0], startMs: cue.startMs, endMs: cue.endMs }], ok: true, warning: null };
  }

  // Durée minimale possible ?
  if (total < pieces.length * opts.minCueDurationMs) {
    return {
      pieces: [{ text: cue.correctedText, startMs: cue.startMs, endMs: cue.endMs }],
      ok: false,
      warning: `Durée insuffisante (${total} ms) pour ${pieces.length} cues lisibles (min ${opts.minCueDurationMs} ms chacun) : révision manuelle nécessaire.`,
    };
  }

  // Répartition proportionnelle avec plancher minCueDurationMs.
  const weights = pieces.map(segmentWeight);
  const sumW = weights.reduce((a, b) => a + b, 0);
  let durations = weights.map((w) => (w / sumW) * total);
  // Applique le plancher en reprenant le temps aux segments les plus longs.
  for (let iter = 0; iter < 10; iter++) {
    let deficit = 0;
    let surplusTotal = 0;
    for (const d of durations) {
      if (d < opts.minCueDurationMs) deficit += opts.minCueDurationMs - d;
      else surplusTotal += d - opts.minCueDurationMs;
    }
    if (deficit === 0 || surplusTotal <= 0) break;
    durations = durations.map((d) => {
      if (d < opts.minCueDurationMs) return opts.minCueDurationMs;
      return d - (deficit * (d - opts.minCueDurationMs)) / surplusTotal;
    });
  }

  // Bornes exactes, sans trous ni chevauchements, fin d'origine préservée.
  const out: SplitResult["pieces"] = [];
  let t = cue.startMs;
  let acc = 0;
  for (let i = 0; i < pieces.length; i++) {
    acc += durations[i];
    const end = i === pieces.length - 1 ? cue.endMs : Math.round(cue.startMs + acc);
    out.push({ text: pieces[i], startMs: Math.round(t), endMs: end });
    t = end;
  }

  return { pieces: out, ok: true, warning: null };
}
