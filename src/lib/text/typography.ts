/**
 * Typographie française déterministe (appliquée localement, sans IA).
 * Règles génériques uniquement — aucun remplacement lié à une vidéo.
 * NBSP = espace insécable (U+00A0).
 */

const NBSP = " ";

export interface TypographyOptions {
  frenchPunctuationSpacing: boolean; // espace avant : ; ? !
  normalizeApostrophes: boolean; // ' -> ’
  normalizeQuotes: boolean; // "..." -> « ... »
  numberUnitSpacing: boolean; // 20°C -> 20 °C, 10km -> 10 km
  normalizeTimes: boolean; // 7h30 -> 7 h 30
}

export const DEFAULT_TYPOGRAPHY: TypographyOptions = {
  frenchPunctuationSpacing: true,
  normalizeApostrophes: true,
  normalizeQuotes: true,
  numberUnitSpacing: true,
  normalizeTimes: true,
};

const UNIT_AFTER_NUMBER =
  /(\d)(°C|°F|km\/h|km|cm|mm|kg|mg|kWh|kHz|MHz|Go|Mo|ko|To|ml|cl|min|[€$£%]|[gmlsWh])(?![\p{L}\d])/gu;

export function applyFrenchTypography(
  input: string,
  opts: Partial<TypographyOptions> = {}
): string {
  const o = { ...DEFAULT_TYPOGRAPHY, ...opts };
  let t = input;

  if (o.normalizeApostrophes) t = t.replace(/(\p{L})'(\p{L})/gu, "$1’$2");

  if (o.normalizeQuotes) {
    // Paires de guillemets droits -> guillemets français avec insécables.
    t = t.replace(/"([^"\n]+)"/g, `«${NBSP}$1${NBSP}»`);
    t = t.replace(/[“]([^”\n]+)[”]/g, `«${NBSP}$1${NBSP}»`);
  }

  if (o.normalizeTimes) {
    // 7h30 / 7 h30 / 7h 30 -> 7 h 30 ; 19h -> 19 h (insécables).
    t = t.replace(/\b(\d{1,2})\s?h\s?(\d{2})\b/g, `$1${NBSP}h${NBSP}$2`);
    t = t.replace(/\b(\d{1,2})\s?h\b(?!\d)/g, `$1${NBSP}h`);
  }

  if (o.numberUnitSpacing) {
    // Colle une insécable entre nombre et unité, sans toucher au nombre.
    t = t.replace(UNIT_AFTER_NUMBER, `$1${NBSP}$2`);
    // Espace existante entre nombre et unité -> insécable.
    t = t.replace(
      new RegExp(`(\\d)\\s+(°C|°F|km/h|km|cm|mm|kg|mg|kWh|Go|Mo|ml|cl|min|[€$£%])(?![\\p{L}\\d])`, "gu"),
      `$1${NBSP}$2`
    );
  }

  if (o.frenchPunctuationSpacing) {
    // Supprime les espaces avant , et . (sauf points de suspension).
    t = t.replace(/\s+([,])/g, "$1");
    t = t.replace(/\s+(\.(?!\.\.))/g, "$1");
    // Insécable avant : ; ? ! (remplace l'espace existante ou l'ajoute).
    t = t.replace(/\s*([:;?!])/g, `${NBSP}$1`);
    // …mais pas en début de ligne ni après un autre signe ( "!!" , "?!", émoticônes ).
    t = t.replace(new RegExp(`^${NBSP}([:;?!])`, "gmu"), "$1");
    t = t.replace(new RegExp(`([:;?!])${NBSP}([:;?!])`, "gu"), "$1$2");
    // Pas d'insécable dans les URL / heures numériques (10:30 rétabli).
    t = t.replace(new RegExp(`(\\d)${NBSP}:(\\d)`, "gu"), "$1:$2");
    t = t.replace(new RegExp(`(https?)${NBSP}:`, "gu"), "$1:");
  }

  return t;
}
