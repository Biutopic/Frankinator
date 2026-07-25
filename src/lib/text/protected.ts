/**
 * Détection générique d'expressions protégées : plages de texte qui ne
 * doivent jamais être coupées entre deux lignes ni entre deux cues.
 * Aucune règle liée à une vidéo particulière — uniquement des motifs.
 */

export interface ProtectedRange {
  start: number;
  end: number; // exclusif
  reason: string;
  text: string;
}

const UNITS =
  "km|m|cm|mm|kg|g|mg|t|l|L|ml|cl|h|min|s|ms|€|\\$|£|%|°C|°F|°|Go|Mo|ko|To|kWh|W|kW|km\\/h|m\\/s|Hz|kHz|MHz";

interface Detector {
  reason: string;
  re: RegExp;
}

const DETECTORS: Detector[] = [
  { reason: "URL", re: /https?:\/\/\S+|www\.\S+|\b[\w-]+\.(?:fr|com|net|org|io|eu)(?:\/\S*)?/giu },
  { reason: "e-mail", re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/giu },
  { reason: "téléphone", re: /\b0\d(?:[ .]\d{2}){4}\b|\+\d{2}(?:[ .]?\d{1,2}){4,5}\b/gu },
  // 7 h 30 / 7h30 / 19 h / 7 h 30 min
  { reason: "heure", re: /\b\d{1,2}\s?h(?:\s?\d{2})?(?:\s?min)?\b/giu },
  // dates : 14 juillet 2026, 14/07/2026
  {
    reason: "date",
    re: /\b\d{1,2}(?:er)?\s(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)(?:\s\d{4})?\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/giu,
  },
  // nombre + unité (avec espace normale ou insécable) : 20 °C, 15 km, 45 %, 3 €
  {
    reason: "nombre + unité",
    re: new RegExp(`\\b\\d+(?:[.,]\\d+)?[\\s\\u00A0\\u202F]?(?:${UNITS})(?![\\p{L}])`, "gu"),
  },
  // quantités écrites : 2,5 millions, 3 milliards
  { reason: "quantité", re: /\b\d+(?:[.,]\d+)?[\s ]?(?:millions?|milliards?|milliers?)\b/giu },
  // Prénom-Nom composés : Jean-Pierre
  { reason: "nom composé", re: /\b\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)+\b/gu },
  // Suites de mots capitalisés (New York, Adobe Premiere Pro) — pas en début de phrase géré par le score
  { reason: "nom propre", re: /\b\p{Lu}[\p{L}.]*(?:[\s ]\p{Lu}[\p{L}.]*)+\b/gu },
  // Initiales : J.-P. / U.S.A.
  { reason: "initiales", re: /\b(?:\p{Lu}\.[-\s]?){2,}/gu },
];

/** Fusionne les plages qui se chevauchent. */
function mergeRanges(ranges: ProtectedRange[]): ProtectedRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: ProtectedRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) {
      if (r.end > last.end) {
        last.end = r.end;
        last.text = last.text; // le texte affiché reste celui de la 1re plage
      }
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export function detectProtectedRanges(
  text: string,
  customExpressions: string[] = [],
  glossary: string[] = []
): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  for (const d of DETECTORS) {
    for (const m of text.matchAll(d.re)) {
      ranges.push({ start: m.index, end: m.index + m[0].length, reason: d.reason, text: m[0] });
    }
  }
  // Expressions utilisateur + glossaire : correspondance insensible à la casse.
  for (const list of [customExpressions, glossary] as const) {
    const reason = list === glossary ? "glossaire" : "expression protégée";
    for (const expr of list) {
      const clean = expr.trim();
      if (!clean) continue;
      const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const m of text.matchAll(new RegExp(escaped, "giu"))) {
        ranges.push({ start: m.index, end: m.index + m[0].length, reason, text: m[0] });
      }
    }
  }
  return mergeRanges(ranges);
}

/** true si couper juste avant l'indice `pos` scinderait une plage protégée. */
export function breakSplitsProtected(pos: number, ranges: ProtectedRange[]): boolean {
  return ranges.some((r) => pos > r.start && pos < r.end);
}
