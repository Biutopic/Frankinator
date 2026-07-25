import type { Cue, ReadingStats } from "../types";
import type { TextMeasurer } from "./measure";

/** Statistiques de lecture d'un cue. Aucune réécriture automatique :
 *  seules des alertes sont produites. */
export function readingStats(
  cue: Pick<Cue, "startMs" | "endMs" | "correctedText" | "formattedLines">,
  measurer: TextMeasurer | null,
  maxWidthPx: number
): ReadingStats {
  const text = (cue.formattedLines.length > 0 ? cue.formattedLines.join(" ") : cue.correctedText)
    .replace(/\s+/g, " ")
    .trim();
  const durationMs = Math.max(cue.endMs - cue.startMs, 1);
  const charCount = text.length;
  const wordCount = text === "" ? 0 : text.split(/\s+/).length;
  const lines = cue.formattedLines.length > 0 ? cue.formattedLines : text ? [text] : [];
  const maxLineWidthPx = measurer
    ? Math.max(0, ...lines.map((l) => measurer.measure(l)))
    : 0;
  return {
    durationMs,
    charCount,
    wordCount,
    charsPerSecond: (charCount / durationMs) * 1000,
    wordsPerMinute: (wordCount / durationMs) * 60_000,
    lineCount: lines.length,
    maxLineWidthPx,
    widthUsagePercent: maxWidthPx > 0 ? (maxLineWidthPx / maxWidthPx) * 100 : 0,
  };
}

/** Détection des cues orphelins (mot faible seul, fragment échoué…). */
export function orphanIssue(text: string, weakWords: string[]): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return "Sous-titre vide.";
  const wordsArr = clean.split(/\s+/);
  const stripped = clean.toLocaleLowerCase("fr").replace(/[.,;:!?…]/g, "");
  if (wordsArr.length === 1 && weakWords.includes(stripped))
    return "Cue réduit à un mot faible : fusion recommandée.";
  if (wordsArr.length <= 2 && /^[a-zàâéèêîôûç' ]+$/i.test(stripped)) {
    const allWeak = stripped.split(" ").every((w) => weakWords.includes(w));
    if (allWeak) return "Fragment isolé (article/préposition/conjonction) : fusion recommandée.";
  }
  return null;
}
