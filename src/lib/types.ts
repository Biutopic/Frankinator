/**
 * Types partagés de Frankinator.
 *
 * Deux opérations distinctes et indépendantes :
 *  - la correction linguistique agit sur `correctedText` (jamais sur le timing)
 *  - le formatage visuel agit sur `formattedLines` / la structure des cues
 */

/** Un sous-titre (cue) sous forme structurée. */
export interface Cue {
  id: number;
  startMs: number;
  endMs: number;
  /** Texte d'origine, jamais modifié après l'import. */
  originalText: string;
  /** Texte courant après correction / édition manuelle. */
  correctedText: string;
  /** Lignes calculées par le moteur de formatage (vide = non formaté). */
  formattedLines: string[];
  /** Un cue verrouillé n'est plus touché par la correction ni le formatage. */
  isLocked: boolean;
  /** Avertissements attachés à ce cue (import, correction, formatage…). */
  warnings: string[];
  /** Timing d'origine pour « restaurer le timing ». */
  originalStartMs: number;
  originalEndMs: number;
  /** État de revue de la correction IA. */
  reviewState: "pending" | "accepted" | "rejected" | "edited" | "untouched";
  /** Proposition de l'IA (avant acceptation), null si aucune. */
  proposedText: string | null;
  /** Confiance renvoyée par l'IA pour la proposition. */
  proposedConfidence: "high" | "low" | null;
  /** Id du cue source quand un cue provient d'un découpage. */
  splitFrom: number | null;
}

/** Problème détecté à l'import ou à la validation. */
export interface SrtIssue {
  severity: "error" | "warning";
  /** Index du cue concerné (numérotation du fichier), null = global. */
  cueId: number | null;
  message: string;
}

export interface ParseResult {
  cues: Cue[];
  issues: SrtIssue[];
}

/** Options de correction linguistique (toggles UI). */
export interface CorrectionOptions {
  spelling: boolean;
  punctuation: boolean;
  frenchTypography: boolean;
  transcriptionErrors: boolean;
  properNames: boolean;
  useGlossary: boolean;
  /** Activé par défaut : les conjugaisons ne sont jamais modifiées. */
  strictConjugations: boolean;
  keepHesitations: boolean;
  removeHesitations: boolean;
  keepRepetitions: boolean;
  removeAccidentalRepetitions: boolean;
  smallNumbersAsWords: boolean;
  normalizeUnits: boolean;
  normalizeTimes: boolean;
  /** minimal = uniquement orthographe/ponctuation évidentes. */
  mode: "minimal" | "standard";
}

export const DEFAULT_CORRECTION_OPTIONS: CorrectionOptions = {
  spelling: true,
  punctuation: true,
  frenchTypography: true,
  transcriptionErrors: true,
  properNames: true,
  useGlossary: true,
  strictConjugations: true,
  keepHesitations: true,
  removeHesitations: false,
  keepRepetitions: true,
  removeAccidentalRepetitions: true,
  smallNumbersAsWords: false,
  normalizeUnits: true,
  normalizeTimes: true,
  mode: "standard",
};

/** Profil de formatage visuel (réutilisable, import/export JSON). */
export interface FormatProfile {
  id: string;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  maxLines: number;
  /** Alignement horizontal du bloc de texte. */
  align: "left" | "center" | "right";
  /** Position verticale du centre du bloc, en % de la hauteur du canvas. */
  positionYPercent: number;
  /** Marges de sécurité gauche/droite en px. */
  safeMarginX: number;
  /** Largeur max du bloc de texte en px (≤ canvasWidth - 2*safeMarginX). */
  maxTextWidth: number;
  fontFamily: string;
  fontWeight: number;
  fontSizePx: number;
  /** Interlettrage en em (ex: -0.04). */
  trackingEm: number;
  /** Interligne (multiplicateur). */
  lineHeight: number;
  /** Durée minimale d'un cue généré par découpage (ms). */
  minCueDurationMs: number;
  /** Écart max entre deux cues pour proposer une fusion (ms). */
  maxMergeGapMs: number;
  /** Seuil d'alerte de vitesse de lecture (caractères / seconde). */
  maxCharsPerSecond: number;
}

export function defaultProfiles(): FormatProfile[] {
  const base = {
    maxLines: 2,
    align: "center" as const,
    positionYPercent: 78,
    minCueDurationMs: 600,
    maxMergeGapMs: 120,
    maxCharsPerSecond: 20,
    lineHeight: 1.15,
  };
  return [
    {
      ...base,
      id: "reel-instagram-premiere",
      name: "Reel Instagram — Premiere",
      canvasWidth: 1080,
      canvasHeight: 1920,
      safeMarginX: 96,
      maxTextWidth: 888,
      fontFamily: "Anybody",
      fontWeight: 800,
      fontSizePx: 65,
      trackingEm: -0.04,
    },
    {
      ...base,
      id: "tiktok-vertical",
      name: "TikTok vertical",
      canvasWidth: 1080,
      canvasHeight: 1920,
      safeMarginX: 110,
      maxTextWidth: 860,
      fontFamily: "Arial",
      fontWeight: 700,
      fontSizePx: 60,
      trackingEm: 0,
    },
    {
      ...base,
      id: "youtube-shorts",
      name: "YouTube Shorts",
      canvasWidth: 1080,
      canvasHeight: 1920,
      safeMarginX: 100,
      maxTextWidth: 880,
      fontFamily: "Arial",
      fontWeight: 700,
      fontSizePx: 58,
      trackingEm: 0,
    },
    {
      ...base,
      id: "horizontal-16-9",
      name: "Vidéo horizontale 16:9",
      canvasWidth: 1920,
      canvasHeight: 1080,
      positionYPercent: 88,
      safeMarginX: 160,
      maxTextWidth: 1600,
      fontFamily: "Arial",
      fontWeight: 600,
      fontSizePx: 64,
      trackingEm: 0,
    },
    {
      ...base,
      id: "custom",
      name: "Personnalisé",
      canvasWidth: 1080,
      canvasHeight: 1920,
      safeMarginX: 96,
      maxTextWidth: 888,
      fontFamily: "Arial",
      fontWeight: 700,
      fontSizePx: 60,
      trackingEm: 0,
    },
  ];
}

/** Statistiques de vitesse de lecture d'un cue. */
export interface ReadingStats {
  durationMs: number;
  charCount: number;
  wordCount: number;
  charsPerSecond: number;
  wordsPerMinute: number;
  lineCount: number;
  maxLineWidthPx: number;
  widthUsagePercent: number;
}
