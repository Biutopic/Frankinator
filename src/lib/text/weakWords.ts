/**
 * Mots « faibles » : à éviter en fin de première ligne ou isolés.
 * Liste configurable — ce sont des préférences de score, pas des règles absolues.
 */
export const DEFAULT_WEAK_WORDS: string[] = [
  "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux",
  "à", "et", "ou", "que", "qui", "quoi", "dont", "où",
  "pour", "dans", "sur", "sous", "avec", "sans", "par", "vers", "chez",
  "ce", "cet", "cette", "ces", "se", "sa", "son", "ses",
  "mon", "ma", "mes", "ton", "ta", "tes",
  "notre", "votre", "leur", "nos", "vos", "leurs",
  "ne", "en", "y", "si", "car", "mais", "donc", "or", "ni",
];

export function isWeakWord(word: string, weakWords: string[] = DEFAULT_WEAK_WORDS): boolean {
  return weakWords.includes(word.toLocaleLowerCase("fr").replace(/['’]$/, ""));
}
