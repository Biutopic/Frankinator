/**
 * Mesure de largeur de texte en pixels réels.
 *
 * Une seule interface `TextMeasurer` est utilisée partout (découpe de lignes,
 * aperçu, détection de dépassement, validation d'export) pour garantir que
 * l'aperçu et le moteur donnent exactement les mêmes résultats.
 */

export interface FontSpec {
  fontFamily: string;
  fontWeight: number;
  fontSizePx: number;
  trackingEm: number;
}

export interface TextMeasurer {
  /** Largeur rendue du texte, tracking inclus, en px. */
  measure(text: string): number;
  /** Police effectivement utilisée (fallback si la demandée est absente). */
  readonly effectiveFamily: string;
  /** true si la police demandée n'a pas pu être chargée. */
  readonly usedFallback: boolean;
}

export const FALLBACK_FONT = "Arial";

/** Attend le chargement de la police via l'API FontFace du navigateur. */
export async function ensureFontLoaded(spec: FontSpec): Promise<boolean> {
  if (typeof document === "undefined" || !("fonts" in document)) return false;
  const desc = `${spec.fontWeight} ${spec.fontSizePx}px "${spec.fontFamily}"`;
  try {
    await document.fonts.load(desc, "Échantillon àéîôù 0123456789");
    return document.fonts.check(desc);
  } catch {
    return false;
  }
}

/** Implémentation Canvas (navigateur). */
export function createCanvasMeasurer(spec: FontSpec, fontAvailable: boolean): TextMeasurer {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible");
  const family = fontAvailable ? spec.fontFamily : FALLBACK_FONT;
  ctx.font = `${spec.fontWeight} ${spec.fontSizePx}px "${family}", ${FALLBACK_FONT}, sans-serif`;
  const trackingPx = spec.trackingEm * spec.fontSizePx;
  // letterSpacing natif si supporté (Chrome 99+), sinon ajout manuel.
  const supportsLetterSpacing = "letterSpacing" in ctx;
  if (supportsLetterSpacing) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${trackingPx}px`;
  }
  return {
    effectiveFamily: family,
    usedFallback: !fontAvailable,
    measure(text: string): number {
      const w = ctx.measureText(text).width;
      if (supportsLetterSpacing) return w;
      // Approximation : tracking appliqué entre chaque paire de caractères.
      return w + Math.max(0, text.length - 1) * trackingPx;
    },
  };
}

/**
 * Mesureur déterministe pour les tests (et le SSR) :
 * chaque caractère a une largeur plausible, accents et ponctuation compris.
 */
export function createFakeMeasurer(spec: FontSpec): TextMeasurer {
  const trackingPx = spec.trackingEm * spec.fontSizePx;
  const widthOf = (ch: string): number => {
    if (/\s/.test(ch)) return 0.28;
    if (/[iIljtf.,;:!'’|]/.test(ch)) return 0.3;
    if (/[mwMW]/.test(ch)) return 0.85;
    if (/[A-ZÀ-Þ]/.test(ch)) return 0.68;
    if (/[0-9]/.test(ch)) return 0.55;
    return 0.52;
  };
  return {
    effectiveFamily: spec.fontFamily,
    usedFallback: false,
    measure(text: string): number {
      let em = 0;
      for (const ch of text) em += widthOf(ch);
      return em * spec.fontSizePx + Math.max(0, [...text].length - 1) * trackingPx;
    },
  };
}
