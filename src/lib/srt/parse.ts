import type { Cue, ParseResult, SrtIssue } from "../types";
import { isStrictTimecode, parseTimecode } from "./timecode";

/**
 * Parseur SRT tolérant : aucun bloc n'est jeté silencieusement.
 * Tout bloc anormal est soit récupéré avec un avertissement,
 * soit signalé comme erreur globale avec son contenu brut.
 */

function makeCue(partial: Partial<Cue> & Pick<Cue, "id" | "startMs" | "endMs" | "originalText">): Cue {
  return {
    correctedText: partial.originalText,
    formattedLines: [],
    isLocked: false,
    warnings: [],
    originalStartMs: partial.startMs,
    originalEndMs: partial.endMs,
    reviewState: "untouched",
    proposedText: null,
    proposedConfidence: null,
    splitFrom: null,
    ...partial,
  };
}

/** Détection grossière d'un décodage raté (mojibake / caractère de remplacement). */
export function detectEncodingIssues(text: string): string | null {
  if (text.includes("�"))
    return "Caractères illisibles détectés (�) : le fichier n'est probablement pas en UTF-8. Ré-enregistrez-le en UTF-8.";
  // Séquences typiques d'un fichier UTF-8 lu en Latin-1 (Ã©, Ã¨, Ã , â€™…)
  if (/Ã[©¨§ â¢®´»«]|â€™|â€œ/.test(text))
    return "Le texte ressemble à de l'UTF-8 mal décodé (« Ã© » au lieu de « é »). Vérifiez l'encodage du fichier.";
  return null;
}

export function parseSrt(input: string): ParseResult {
  const issues: SrtIssue[] = [];
  const cues: Cue[] = [];

  // BOM + normalisation des fins de ligne.
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  const enc = detectEncodingIssues(text);
  if (enc) issues.push({ severity: "warning", cueId: null, message: enc });

  if (text.trim() === "") {
    issues.push({ severity: "error", cueId: null, message: "Le fichier SRT est vide." });
    return { cues, issues };
  }

  // Blocs séparés par au moins une ligne vide.
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b !== "");

  const timeLineRe = /^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/;
  let autoId = 0;

  for (const block of blocks) {
    const lines = block.split("\n");
    let idx = 0;

    // 1. Numéro de cue (optionnel dans les fichiers mal formés).
    let cueId: number | null = null;
    if (/^\d+$/.test(lines[0].trim())) {
      cueId = Number(lines[0].trim());
      idx = 1;
    }

    // 2. Ligne de timecode.
    const timeLine = lines[idx];
    const tm = timeLine ? timeLine.match(timeLineRe) : null;
    if (!tm || !timeLine.includes("-->")) {
      issues.push({
        severity: "error",
        cueId,
        message: `Bloc corrompu (pas de timecode) : « ${block.slice(0, 60)}${block.length > 60 ? "…" : ""} »`,
      });
      continue;
    }
    idx++;

    const startMs = parseTimecode(tm[1]);
    const endMs = parseTimecode(tm[2]);
    autoId++;
    const id = cueId ?? autoId;

    if (startMs === null || endMs === null) {
      issues.push({
        severity: "error",
        cueId: id,
        message: `Timecode invalide : « ${timeLine.trim()} »`,
      });
      continue;
    }

    const warnings: string[] = [];
    if (cueId === null) warnings.push("Numéro de cue manquant, numéroté automatiquement.");
    if (!isStrictTimecode(tm[1]) || !isStrictTimecode(tm[2]))
      warnings.push("Timecode non standard (corrigé au format SRT à l'export).");
    if (endMs <= startMs) warnings.push("Fin antérieure ou égale au début.");

    const body = lines.slice(idx).join("\n").trim();
    if (body === "") warnings.push("Sous-titre vide.");

    cues.push(makeCue({ id, startMs, endMs, originalText: body, warnings }));
  }

  if (cues.length === 0)
    issues.push({ severity: "error", cueId: null, message: "Aucun sous-titre exploitable dans ce fichier." });

  // Numérotation : doublons et trous.
  const seen = new Map<number, number>();
  for (const c of cues) seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
  for (const [id, count] of seen)
    if (count > 1)
      issues.push({ severity: "warning", cueId: id, message: `Index ${id} dupliqué (${count} fois). Renuméroté à l'export.` });

  const sorted = [...cues].sort((a, b) => a.id - b.id);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].id > sorted[i - 1].id + 1)
      issues.push({
        severity: "warning",
        cueId: sorted[i].id,
        message: `Saut de numérotation entre ${sorted[i - 1].id} et ${sorted[i].id}.`,
      });
  }

  // Ordre temporel + chevauchements.
  const byTime = [...cues].sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < byTime.length; i++) {
    if (byTime[i].startMs < byTime[i - 1].endMs)
      issues.push({
        severity: "warning",
        cueId: byTime[i].id,
        message: `Chevauchement avec le cue ${byTime[i - 1].id}.`,
      });
  }

  return { cues, issues };
}
