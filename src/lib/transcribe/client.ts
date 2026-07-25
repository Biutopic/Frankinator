"use client";

import type { Cue } from "../types";
import { decodeToMono16k, chunkAudio } from "./audio";
import { transcriptToCues, mergeChunkCues, type TranscriptSegment } from "./segments";

/**
 * Transcription d'une vidéo/audio en cues, via le proxy Cloudflare
 * (Whisper sur Workers AI). Seul l'audio compressé part au proxy —
 * jamais la vidéo.
 */

const ENDPOINT =
  (process.env.NEXT_PUBLIC_CORRECT_ENDPOINT || "https://frankinator-correct.elven-6eb.workers.dev") +
  "/transcribe";

export async function transcribeMedia(
  file: File,
  language: string,
  onProgress: (message: string) => void
): Promise<Cue[]> {
  onProgress("Extraction de l'audio (dans votre navigateur)…");
  const samples = await decodeToMono16k(file);
  const chunks = chunkAudio(samples);

  const parts: Cue[][] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress(
      chunks.length > 1
        ? `Transcription ${i + 1}/${chunks.length}…`
        : "Transcription en cours (Whisper)…"
    );
    const res = await fetch(`${ENDPOINT}?lang=${encodeURIComponent(language)}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: chunks[i].base64,
    });
    const data = (await res.json().catch(() => null)) as
      | { cues?: TranscriptSegment[]; message?: string }
      | null;
    if (!res.ok) {
      throw new Error(data?.message ?? `Erreur de transcription (${res.status}).`);
    }
    parts.push(transcriptToCues(data?.cues ?? [], chunks[i].offsetMs));
  }

  const cues = mergeChunkCues(parts);
  if (cues.length === 0)
    throw new Error("Aucune parole détectée dans ce média.");
  return cues;
}
