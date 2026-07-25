import type { Cue } from "../types";
import type { BreakOptions } from "./linebreak";
import { breakIntoLines } from "./linebreak";

/**
 * Fusion optionnelle de cues adjacents. Jamais automatique :
 * `canMerge` produit une proposition que l'utilisateur valide.
 */

export interface MergeOptions extends BreakOptions {
  maxMergeGapMs: number;
  maxCharsPerSecond: number;
}

export interface MergeCheck {
  ok: boolean;
  reason: string | null;
}

export function canMerge(a: Cue, b: Cue, opts: MergeOptions): MergeCheck {
  const gap = b.startMs - a.endMs;
  if (gap > opts.maxMergeGapMs)
    return { ok: false, reason: `Écart de ${gap} ms > seuil de ${opts.maxMergeGapMs} ms.` };
  if (gap < 0) return { ok: false, reason: "Les cues se chevauchent : corrigez le timing d'abord." };
  if (a.isLocked || b.isLocked) return { ok: false, reason: "Cue verrouillé." };

  // Frontière de locuteur (tiret de dialogue en tête du second cue).
  if (/^\s*[-–—]/.test(b.correctedText))
    return { ok: false, reason: "Changement de locuteur détecté (tiret de dialogue)." };

  const combined = `${a.correctedText.replace(/\s+/g, " ").trim()} ${b.correctedText.replace(/\s+/g, " ").trim()}`;

  // Connexion grammaticale plausible : le 1er cue ne finit pas par une phrase close.
  if (/[.!?…]\s*$/u.test(a.correctedText.trim()) && /^\p{Lu}/u.test(b.correctedText.trim()))
    return { ok: false, reason: "Les deux phrases sont indépendantes." };

  const broken = breakIntoLines(combined, opts);
  if (broken.overflow)
    return { ok: false, reason: "Le texte combiné ne tient pas dans le profil de formatage." };

  const durationS = (b.endMs - a.startMs) / 1000;
  const cps = combined.length / Math.max(durationS, 0.001);
  if (cps > opts.maxCharsPerSecond)
    return { ok: false, reason: `Vitesse de lecture trop élevée après fusion (${cps.toFixed(1)} c/s).` };

  return { ok: true, reason: null };
}

/** Fusionne b dans a (timing englobant, textes concaténés). */
export function mergeCues(a: Cue, b: Cue): Cue {
  return {
    ...a,
    endMs: b.endMs,
    originalText: `${a.originalText} ${b.originalText}`,
    correctedText: `${a.correctedText.replace(/\s+$/, "")} ${b.correctedText.replace(/^\s+/, "")}`,
    formattedLines: [],
    warnings: [...a.warnings, ...b.warnings],
    reviewState: "edited",
  };
}
