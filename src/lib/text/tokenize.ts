/**
 * Tokenisation adaptée au français.
 * Les constructions avec apostrophe (j'ai, l'arrivée, qu'on, jusqu'à…)
 * sont des tokens indivisibles, apostrophe droite (') ou typographique (').
 */

export const APOSTROPHES = /['’]/;

export interface Token {
  text: string;
  /** Position de départ dans la chaîne source. */
  start: number;
  kind: "word" | "space" | "punct";
}

// Un « mot » peut contenir lettres, chiffres, tirets internes et apostrophes
// internes : « j'ai », « Jean-Pierre », « aujourd'hui », « 2,5 » (virgule décimale).
// Le nombre décimal est testé en premier (l'alternative est ordonnée).
const WORD_RE =
  /\d+(?:[.,]\d+)+|[\p{L}\p{N}]+(?:[''’−\-][\p{L}\p{N}]+)*(?:[''’])?/gu;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const flushGap = (until: number) => {
    while (i < until) {
      const ch = text[i];
      if (/\s/.test(ch)) {
        let j = i;
        while (j < until && /\s/.test(text[j])) j++;
        tokens.push({ text: text.slice(i, j), start: i, kind: "space" });
        i = j;
      } else {
        tokens.push({ text: ch, start: i, kind: "punct" });
        i++;
      }
    }
  };
  for (const m of text.matchAll(WORD_RE)) {
    flushGap(m.index);
    tokens.push({ text: m[0], start: m.index, kind: "word" });
    i = m.index + m[0].length;
  }
  flushGap(text.length);

  // Fusionne « l' » + « arrivée » si l'apostrophe termine un token mot :
  // le mot élidé et le mot suivant forment un token indivisible.
  const merged: Token[] = [];
  for (const t of tokens) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.kind === "word" &&
      APOSTROPHES.test(prev.text[prev.text.length - 1]) &&
      t.kind === "word"
    ) {
      prev.text += t.text;
      continue;
    }
    merged.push({ ...t });
  }
  return merged;
}

/** Les mots de la chaîne, apostrophes liées (pour découpe de lignes). */
export function words(text: string): string[] {
  return tokenize(text)
    .filter((t) => t.kind === "word")
    .map((t) => t.text);
}

/** true si le token est une construction élidée indivisible (j'ai, qu'on…). */
export function isApostropheConstruction(word: string): boolean {
  return APOSTROPHES.test(word) && !/^['’]|['’]$/.test(word);
}
