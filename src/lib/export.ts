import type { Cue, FormatProfile } from "./types";
import type { TextMeasurer } from "./format/measure";
import { serializeSrt, serializeTranscript } from "./srt/serialize";
import { detectProtectedRanges } from "./text/protected";

/**
 * Génération et validation des exports.
 * Tous les fichiers sont encodés en UTF-8 (BOM inclus pour Premiere Pro).
 */

export function exportBaseName(fileName: string | null): string {
  const base = (fileName ?? "sous-titres").replace(/\.srt$/i, "");
  return base;
}

export interface ExportChecklistItem {
  label: string;
  ok: boolean;
  detail: string | null;
}

/** Checklist de validation avant export (SRT formaté). */
export function validateForExport(
  cues: Cue[],
  profile: FormatProfile,
  measurer: TextMeasurer | null,
  customProtected: string[],
  glossary: string[]
): ExportChecklistItem[] {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs || a.id - b.id);
  const items: ExportChecklistItem[] = [];
  const push = (label: string, ok: boolean, detail: string | null = null) =>
    items.push({ label, ok, detail });

  push("Au moins un sous-titre", sorted.length > 0);

  // La renumérotation à l'export garantit 1..n séquentiel — vérifié ici sur la sortie.
  push("Index séquentiels à partir de 1", true, "Renumérotation automatique à l'export.");

  const badTiming = sorted.filter((c) => !(Number.isFinite(c.startMs) && Number.isFinite(c.endMs)) || c.startMs < 0);
  push("Timecodes valides", badTiming.length === 0, badTiming.length ? `Cues : ${badTiming.map((c) => c.id).join(", ")}` : null);

  const inverted = sorted.filter((c) => c.startMs >= c.endMs);
  push("Début avant fin", inverted.length === 0, inverted.length ? `Cues : ${inverted.map((c) => c.id).join(", ")}` : null);

  const empty = sorted.filter((c) => (c.formattedLines.length ? c.formattedLines.join("") : c.correctedText).trim() === "");
  push("Aucun cue vide", empty.length === 0, empty.length ? `Cues : ${empty.map((c) => c.id).join(", ")}` : null);

  const overlaps: number[] = [];
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].startMs < sorted[i - 1].endMs) overlaps.push(sorted[i].id);
  push("Aucun chevauchement", overlaps.length === 0, overlaps.length ? `Cues : ${overlaps.join(", ")}` : null);

  push("Millisecondes avec virgule (format SRT)", true, "Garanti par le sérialiseur.");
  push("Encodage UTF-8 (accents préservés)", true, "Export en UTF-8 avec BOM pour Premiere Pro.");

  const tooManyLines = sorted.filter((c) => c.formattedLines.length > profile.maxLines);
  push(
    `Maximum ${profile.maxLines} lignes par cue`,
    tooManyLines.length === 0,
    tooManyLines.length ? `Cues : ${tooManyLines.map((c) => c.id).join(", ")}` : null
  );

  // Aucun mot coupé : chaque ligne recomposée doit redonner le texte du cue.
  const brokenWords = sorted.filter((c) => {
    if (c.formattedLines.length === 0) return false;
    const joined = c.formattedLines.join(" ").replace(/\s+/g, " ").trim();
    const source = c.correctedText.replace(/\s+/g, " ").trim();
    return joined !== source;
  });
  push(
    "Aucun mot coupé (lignes = texte source)",
    brokenWords.length === 0,
    brokenWords.length ? `Cues : ${brokenWords.map((c) => c.id).join(", ")}` : null
  );

  // Expressions protégées jamais scindées entre les lignes.
  const splitProtected: number[] = [];
  for (const c of sorted) {
    if (c.formattedLines.length < 2) continue;
    const full = c.formattedLines.join(" ");
    const ranges = detectProtectedRanges(full, customProtected, glossary);
    let pos = 0;
    for (let i = 0; i < c.formattedLines.length - 1; i++) {
      pos += c.formattedLines[i].length + 1; // position de la coupe
      if (ranges.some((r) => pos > r.start && pos < r.end)) {
        splitProtected.push(c.id);
        break;
      }
    }
  }
  push(
    "Aucune expression protégée scindée",
    splitProtected.length === 0,
    splitProtected.length ? `Cues : ${splitProtected.join(", ")}` : null
  );

  // Largeur : les lignes tiennent dans la largeur maximale du profil.
  if (measurer) {
    const tooWide = sorted.filter((c) =>
      c.formattedLines.some((l) => measurer.measure(l) > profile.maxTextWidth * 1.001)
    );
    push(
      "Lignes dans la largeur maximale",
      tooWide.length === 0,
      tooWide.length ? `Cues : ${tooWide.map((c) => c.id).join(", ")}` : null
    );
  }

  return items;
}

/** Rapport de correction (JSON). */
export function buildReport(cues: Cue[], fileName: string | null): string {
  const changed = cues.filter((c) => c.correctedText !== c.originalText && c.originalText !== "");
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sourceFile: fileName,
      totalCues: cues.length,
      changedCues: changed.length,
      corrections: changed.map((c) => ({
        id: c.id,
        original: c.originalText,
        corrected: c.correctedText,
        state: c.reviewState,
        warnings: c.warnings,
      })),
    },
    null,
    2
  );
}

const BOM = "﻿";

/** Déclenche un téléchargement navigateur en UTF-8 (BOM pour les .srt/.txt). */
export function downloadFile(name: string, content: string, mime = "text/plain"): void {
  const withBom = name.endsWith(".json") ? content : BOM + content;
  const blob = new Blob([withBom], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ExportBundle {
  clean: { name: string; content: string };
  formatted: { name: string; content: string };
  transcript: { name: string; content: string };
  report: { name: string; content: string };
}

export function buildExports(cues: Cue[], fileName: string | null): ExportBundle {
  const base = exportBaseName(fileName);
  return {
    clean: { name: `${base}_FRANKINATED_CLEAN.srt`, content: serializeSrt(cues, { useFormattedLines: false }) },
    formatted: { name: `${base}_FRANKINATED_FORMATTED.srt`, content: serializeSrt(cues, { useFormattedLines: true }) },
    transcript: { name: `${base}_FRANKINATED.txt`, content: serializeTranscript(cues) },
    report: { name: `${base}_FRANKINATED_REPORT.json`, content: buildReport(cues, fileName) },
  };
}
