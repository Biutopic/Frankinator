import type { TextMeasurer } from "./measure";
import { detectProtectedRanges, breakSplitsProtected, type ProtectedRange } from "../text/protected";
import { tokenize, type Token } from "../text/tokenize";
import { DEFAULT_WEAK_WORDS, isWeakWord } from "../text/weakWords";

/**
 * Découpe de lignes par score linguistique + mesure pixel réelle.
 * Jamais de coupe au milieu d'un mot, d'une construction élidée
 * ou d'une expression protégée.
 */

export interface BreakOptions {
  measurer: TextMeasurer;
  maxWidthPx: number;
  maxLines: number;
  weakWords?: string[];
  customProtected?: string[];
  glossary?: string[];
}

export interface BreakResult {
  lines: string[];
  /** true si le texte ne tient pas dans maxLines (à découper en plusieurs cues). */
  overflow: boolean;
  /** Largeur de la ligne la plus large, en px. */
  maxLineWidthPx: number;
}

interface Candidate {
  /** Position de coupe dans la chaîne (début de la 2e partie). */
  pos: number;
  score: number;
}

const PUNCT_BONUS = /[.,;:!?…»)]$/u;

/** Positions de coupe valides : uniquement sur des espaces hors plages protégées. */
function breakPositions(text: string, tokens: Token[], ranges: ProtectedRange[]): number[] {
  const out: number[] = [];
  for (const t of tokens) {
    if (t.kind !== "space") continue;
    const pos = t.start + t.text.length; // coupe = début du token suivant
    if (pos <= 0 || pos >= text.length) continue;
    if (breakSplitsProtected(pos, ranges)) continue;
    out.push(pos);
  }
  return out;
}

function lastWord(s: string): string {
  const m = s.trim().match(/[\p{L}\p{N}'’-]+$/u);
  return m ? m[0] : "";
}
function firstWord(s: string): string {
  const m = s.trim().match(/^[\p{L}\p{N}'’-]+/u);
  return m ? m[0] : "";
}

/**
 * Score d'une coupe en deux lignes. Plus haut = meilleur.
 * Retourne -Infinity si la coupe est invalide (dépassement).
 */
export function scoreBreak(
  text: string,
  pos: number,
  opts: BreakOptions
): number {
  const weak = opts.weakWords ?? DEFAULT_WEAK_WORDS;
  const l1 = text.slice(0, pos).trimEnd();
  const l2 = text.slice(pos).trimStart();
  const w1 = opts.measurer.measure(l1);
  const w2 = opts.measurer.measure(l2);

  // 1. Les deux lignes doivent tenir en largeur — règle absolue.
  if (w1 > opts.maxWidthPx || w2 > opts.maxWidthPx) return -Infinity;

  let score = 100;

  // 5. La coupe suit une ponctuation : très bon point d'appui.
  if (PUNCT_BONUS.test(l1)) score += 40;

  // 7. Équilibre visuel des deux lignes.
  const balance = 1 - Math.abs(w1 - w2) / Math.max(w1 + w2, 1);
  score += balance * 30;

  // 8. Deuxième ligne trop courte.
  if (w2 < opts.maxWidthPx * 0.18) score -= 25;

  // 9. La 1re ligne ne doit pas finir par un mot faible.
  if (isWeakWord(lastWord(l1), weak)) score -= 35;

  // 10. La 2e ligne ne doit pas commencer par un mot faible isolé.
  const f2 = firstWord(l2);
  if (isWeakWord(f2, weak) && l2.trim().split(/\s+/).length <= 2) score -= 30;

  // 13. Rythme : légère préférence pour une 1re ligne un peu plus longue.
  if (w1 >= w2) score += 5;

  return score;
}

/**
 * Découpe `text` en au plus `maxLines` lignes.
 * Pour maxLines = 2, teste toutes les frontières de mots valides.
 */
export function breakIntoLines(text: string, opts: BreakOptions): BreakResult {
  const clean = text.replace(/\s+/g, " ").trim();
  const measure = (s: string) => opts.measurer.measure(s);

  if (clean === "") return { lines: [], overflow: false, maxLineWidthPx: 0 };

  // Tient sur une seule ligne ?
  if (measure(clean) <= opts.maxWidthPx) {
    return { lines: [clean], overflow: false, maxLineWidthPx: measure(clean) };
  }

  const ranges = detectProtectedRanges(clean, opts.customProtected ?? [], opts.glossary ?? []);
  const tokens = tokenize(clean);
  const positions = breakPositions(clean, tokens, ranges);

  if (opts.maxLines >= 2) {
    const candidates: Candidate[] = positions
      .map((pos) => ({ pos, score: scoreBreak(clean, pos, opts) }))
      .filter((c) => c.score > -Infinity)
      .sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      const best = candidates[0];
      const l1 = clean.slice(0, best.pos).trimEnd();
      const l2 = clean.slice(best.pos).trimStart();
      return {
        lines: [l1, l2],
        overflow: false,
        maxLineWidthPx: Math.max(measure(l1), measure(l2)),
      };
    }
  }

  // Aucun découpage en maxLines lignes ne tient : overflow -> découpage en cues.
  return { lines: [clean], overflow: true, maxLineWidthPx: measure(clean) };
}
