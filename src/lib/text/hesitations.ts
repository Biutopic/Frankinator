/**
 * Suppression déterministe des hésitations françaises (« euh », « heu »,
 * « hum », « hmm »… avec élongations : « euuuh », « heuuu »).
 * Règle générique, aucune liste liée à une vidéo. Le reste du texte,
 * la ponctuation utile et les sauts de ligne sont préservés.
 */

// Interjections d'hésitation, élongations comprises. \b protège « heure »,
// « humeur », etc. (le motif doit être un mot entier).
const HESITATION_WORD = /\b(?:e+u+h+|h+e+u+h*|h+u+m+|h+m+m*|m+m+h+|m+h+m+)\b/giu;

function stripLine(line: string): string {
  const original = line;
  let t = line;

  // Retire le mot d'hésitation et une éventuelle virgule/ellipse qui le suit.
  t = t.replace(new RegExp(`${HESITATION_WORD.source}\\s*[,…]?`, "giu"), "");

  // Nettoyage des artefacts de ponctuation laissés par la suppression.
  t = t
    .replace(/\s{2,}/g, " ") // doubles espaces
    .replace(/\s+([,.;:!?…])/g, "$1") // espace orphelin avant ponctuation simple
    .replace(/,\s*,/g, ",") // « , , » -> « , »
    .replace(/^[\s,…]+/, "") // ponctuation orpheline en début de ligne
    .replace(/\s+$/, "")
    .replace(/^\s+/, "");

  // Si l'hésitation ouvrait la phrase avec une majuscule, on remonte
  // la majuscule sur le mot suivant.
  if (
    t !== "" &&
    original !== t &&
    /^[A-ZÀ-Þ]/.test(original.trim()) &&
    /^[a-zà-þ]/.test(t)
  ) {
    t = t[0].toLocaleUpperCase("fr") + t.slice(1);
  }
  return t;
}

/** Retire les hésitations d'un texte de cue (multi-lignes autorisées). */
export function stripHesitations(text: string): string {
  return text
    .split("\n")
    .map(stripLine)
    .join("\n");
}
