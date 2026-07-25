import type { CorrectionRequest } from "./schema";
import type { CorrectionOptions } from "../types";

/**
 * Construction du prompt de correction — partagé entre la route serveur
 * et le mode navigateur. Le système est volontairement conservateur.
 */

export function buildSystemPrompt(): string {
  return `Tu es un correcteur de sous-titres professionnel. Tu corriges des sous-titres issus d'une transcription automatique, dans la langue indiquée.

RÈGLE D'OR : tu es CONSERVATEUR. Tu corriges les erreurs objectives, tu ne réécris jamais.

TU CORRIGES UNIQUEMENT (selon les options actives) :
- l'orthographe
- la ponctuation
- les majuscules
- les accents manquants
- la typographie française
- les erreurs manifestes de reconnaissance vocale (mots mal transcrits évidents d'après le contexte)
- les doublons manifestes de mots ("le le")
- les mots incorrectement séparés ("j ai" → "j'ai") ou collés
- les chiffres utilisés à tort à la place de lettres (si l'option est active)
- les espaces incorrects avant la ponctuation ou autour des unités
- les noms propres UNIQUEMENT s'ils sont confirmés par le contexte ou le glossaire

TU PRÉSERVES TOUJOURS :
- le sens et l'intention du locuteur
- le vocabulaire et le registre (l'oral familier reste familier)
- la structure des phrases autant que possible
- les temps verbaux et les conjugaisons (sauf autorisation explicite)
- les répétitions volontaires
- les hésitations (sauf si l'option de suppression est active)
- la terminologie existante en cas de doute

TU NE FAIS JAMAIS :
- de réécriture stylistique ou littéraire
- d'amélioration de l'argumentation
- de résumé, d'ajout ou de suppression d'information
- de changement de position du locuteur
- de remplacement du langage familier par du langage soutenu
- de supposition sur un nom propre incertain
- d'explication ou de commentaire dans le champ correctedText

EN CAS DE DOUTE : tu renvoies le texte ORIGINAL inchangé, avec confidence "low" et un court warning en français expliquant le doute.

Tu renvoies uniquement le JSON demandé : un item par cue reçu, mêmes ids, sans en ajouter ni en retirer. Les sauts de ligne internes des sous-titres sont préservés tels quels.`;
}

function describeOptions(options: Partial<CorrectionOptions>): string {
  const lines: string[] = [];
  const on = (k: keyof CorrectionOptions) => options[k] === true;
  if (on("spelling")) lines.push("- Corriger l'orthographe");
  if (on("punctuation")) lines.push("- Corriger la ponctuation");
  if (on("frenchTypography")) lines.push("- Appliquer la typographie française (espaces avant : ; ? !, apostrophes typographiques, espaces nombre-unité)");
  if (on("transcriptionErrors")) lines.push("- Corriger les erreurs manifestes de transcription automatique");
  if (on("properNames")) lines.push("- Corriger les noms propres confirmés par le contexte ou le glossaire");
  if (on("useGlossary")) lines.push("- Utiliser le glossaire fourni comme référence d'orthographe");
  if (on("strictConjugations")) lines.push("- INTERDICTION ABSOLUE de modifier les conjugaisons et temps verbaux");
  if (on("keepHesitations")) lines.push("- Conserver les hésitations (euh, ben, bah…)");
  if (on("removeHesitations")) lines.push("- Supprimer les hésitations (euh, hum…) sans toucher au reste");
  if (on("keepRepetitions")) lines.push("- Conserver toutes les répétitions");
  if (on("removeAccidentalRepetitions")) lines.push("- Supprimer uniquement les doublons accidentels de mots (« le le »)");
  if (on("smallNumbersAsWords")) lines.push("- Écrire les petits nombres (≤ 10) en lettres quand ils ne sont pas suivis d'une unité");
  if (on("normalizeUnits")) lines.push("- Normaliser les unités (20°C → 20 °C, 10km → 10 km)");
  if (on("normalizeTimes")) lines.push("- Normaliser les heures (7h30 → 7 h 30)");
  if (options.mode === "minimal")
    lines.push("- MODE MINIMAL : uniquement les fautes d'orthographe et de ponctuation évidentes, rien d'autre");
  return lines.join("\n");
}

export function buildUserPrompt(req: CorrectionRequest): string {
  const parts: string[] = [];
  parts.push(`Langue des sous-titres : ${req.language}`);
  if (req.videoContext.trim()) parts.push(`Contexte de la vidéo :\n${req.videoContext.trim()}`);
  if (req.glossary.length > 0)
    parts.push(`Glossaire (orthographes de référence) :\n${req.glossary.map((g) => `- ${g}`).join("\n")}`);
  if (req.referenceTranscript.trim())
    parts.push(`Transcript de référence (extrait) :\n${req.referenceTranscript.slice(0, 4000)}`);
  parts.push(`Options de correction actives :\n${describeOptions(req.options as Partial<CorrectionOptions>)}`);
  if (req.contextBefore.trim()) parts.push(`Sous-titres précédents (contexte, NE PAS corriger) :\n${req.contextBefore}`);
  if (req.contextAfter.trim()) parts.push(`Sous-titres suivants (contexte, NE PAS corriger) :\n${req.contextAfter}`);
  parts.push(
    `Sous-titres à corriger (JSON) :\n${JSON.stringify(
      req.cues.map((c) => ({ id: c.id, text: c.text })),
      null,
      2
    )}`
  );
  return parts.join("\n\n");
}
