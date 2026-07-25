import type { Cue, FormatProfile } from "../types";
import type { TextMeasurer } from "./measure";
import { breakIntoLines, type BreakOptions } from "./linebreak";
import { splitLongCue } from "./split";
import { canMerge, mergeCues } from "./merge";
import { orphanIssue, readingStats } from "./readingSpeed";
import { DEFAULT_WEAK_WORDS } from "../text/weakWords";

/**
 * Applique le formatage visuel à l'ensemble des cues :
 * - calcule les lignes (max profile.maxLines) via la mesure pixel réelle
 * - découpe les cues trop longs en cues consécutifs
 * - n'altère jamais les cues verrouillés
 * - signale les cas impossibles au lieu de produire des sous-titres illisibles
 */

export interface FormatRunResult {
  cues: Cue[];
  warnings: string[];
}

/**
 * « Appliquer les recommandations » : fusionne automatiquement les paires
 * adjacentes quand la fusion est VALIDE (écart, largeur, vitesse, locuteur,
 * verrous — via canMerge) ET qu'elle résout un problème signalé (cue
 * orphelin, vitesse de lecture trop élevée, durée trop courte), puis
 * relance le formatage complet. Déclenché uniquement par l'utilisateur.
 */
export function applyRecommendations(
  cues: Cue[],
  profile: FormatProfile,
  measurer: TextMeasurer,
  customProtected: string[],
  glossary: string[],
  weakWords: string[] = DEFAULT_WEAK_WORDS
): FormatRunResult & { mergesApplied: number } {
  const mergeOpts = {
    measurer,
    maxWidthPx: profile.maxTextWidth,
    maxLines: profile.maxLines,
    weakWords,
    customProtected,
    glossary,
    maxMergeGapMs: profile.maxMergeGapMs,
    maxCharsPerSecond: profile.maxCharsPerSecond,
  };
  const hasIssue = (c: Cue): boolean => {
    if (orphanIssue(c.correctedText, weakWords)) return true;
    const stats = readingStats(c, null, profile.maxTextWidth);
    return (
      stats.charsPerSecond > profile.maxCharsPerSecond ||
      stats.durationMs < profile.minCueDurationMs
    );
  };

  let work = [...cues].sort((a, b) => a.startMs - b.startMs || a.id - b.id);
  let mergesApplied = 0;
  let changed = true;
  while (changed && mergesApplied < 500) {
    changed = false;
    for (let i = 0; i < work.length - 1; i++) {
      const a = work[i];
      const b = work[i + 1];
      if (!hasIssue(a) && !hasIssue(b)) continue;
      if (!canMerge(a, b, mergeOpts).ok) continue;
      work = [...work.slice(0, i), mergeCues(a, b), ...work.slice(i + 2)];
      mergesApplied++;
      changed = true;
      break;
    }
  }

  const result = formatAllCues(work, profile, measurer, customProtected, glossary, weakWords);
  return { ...result, mergesApplied };
}

export function formatAllCues(
  cues: Cue[],
  profile: FormatProfile,
  measurer: TextMeasurer,
  customProtected: string[],
  glossary: string[],
  weakWords: string[] = DEFAULT_WEAK_WORDS
): FormatRunResult {
  const warnings: string[] = [];
  const breakOpts: BreakOptions = {
    measurer,
    maxWidthPx: profile.maxTextWidth,
    maxLines: profile.maxLines,
    weakWords,
    customProtected,
    glossary,
  };

  const out: Cue[] = [];
  let nextId = Math.max(0, ...cues.map((c) => c.id)) + 1;

  for (const cue of [...cues].sort((a, b) => a.startMs - b.startMs || a.id - b.id)) {
    if (cue.isLocked) {
      out.push(cue); // les cues verrouillés ne sont jamais reformés
      continue;
    }

    const result = breakIntoLines(cue.correctedText, breakOpts);

    if (!result.overflow) {
      const cueWarnings = cue.warnings.filter((w) => !w.startsWith("[format]"));
      const orphan = orphanIssue(cue.correctedText, weakWords);
      if (orphan) cueWarnings.push(`[format] ${orphan}`);
      out.push({ ...cue, formattedLines: result.lines, warnings: cueWarnings });
      continue;
    }

    // Trop long : découpage en cues consécutifs.
    const split = splitLongCue(cue, { ...breakOpts, minCueDurationMs: profile.minCueDurationMs });
    if (!split.ok || split.pieces.length === 1) {
      const msg = split.warning ?? "Texte trop long pour le profil : révision manuelle nécessaire.";
      warnings.push(`Cue ${cue.id} : ${msg}`);
      out.push({
        ...cue,
        formattedLines: result.lines,
        warnings: [...cue.warnings.filter((w) => !w.startsWith("[format]")), `[format] ${msg}`],
      });
      continue;
    }

    split.pieces.forEach((piece, i) => {
      const lines = breakIntoLines(piece.text, breakOpts);
      out.push({
        ...cue,
        id: i === 0 ? cue.id : nextId++,
        startMs: piece.startMs,
        endMs: piece.endMs,
        originalText: i === 0 ? cue.originalText : "",
        correctedText: piece.text,
        formattedLines: lines.lines,
        splitFrom: i === 0 ? cue.splitFrom : cue.id,
        warnings:
          i === 0
            ? [...cue.warnings.filter((w) => !w.startsWith("[format]")), `[format] Découpé en ${split.pieces.length} cues.`]
            : [`[format] Issu du découpage du cue ${cue.id}.`],
      });
    });
  }

  return { cues: out, warnings };
}
