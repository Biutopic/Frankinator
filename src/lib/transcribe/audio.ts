"use client";

/**
 * Extraction audio côté navigateur : la vidéo ne quitte JAMAIS la machine.
 * On décode la piste audio, on la ré-échantillonne en mono 16 kHz, puis on
 * l'encode en WAV 16 bits, découpée en morceaux de ~4 minutes (limite du
 * proxy de transcription).
 */

const SAMPLE_RATE = 16_000;
export const CHUNK_SECONDS = 240; // 4 minutes par morceau
export const MAX_MEDIA_MINUTES = 40;

/** Décode n'importe quel média supporté par le navigateur en PCM mono 16 kHz. */
export async function decodeToMono16k(file: File): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();
  const probe = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error(
      "Impossible de lire l'audio de ce fichier (format non supporté par le navigateur). Essayez un MP4/MP3/WAV."
    );
  } finally {
    void probe.close();
  }
  if (decoded.duration > MAX_MEDIA_MINUTES * 60)
    throw new Error(`Média trop long (${Math.round(decoded.duration / 60)} min, max ${MAX_MEDIA_MINUTES} min).`);

  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Encode un tableau de samples PCM en fichier WAV 16 bits mono 16 kHz. */
export function encodeWav(samples: Float32Array): Uint8Array {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Uint8Array(buffer);
}

/** Base64 sans dépassement de pile (par blocs). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface AudioChunk {
  base64: string;
  offsetMs: number;
}

/** Découpe le PCM en morceaux WAV base64 prêts à envoyer. */
export function chunkAudio(samples: Float32Array): AudioChunk[] {
  const perChunk = CHUNK_SECONDS * SAMPLE_RATE;
  const chunks: AudioChunk[] = [];
  for (let i = 0; i < samples.length; i += perChunk) {
    chunks.push({
      base64: toBase64(encodeWav(samples.subarray(i, i + perChunk))),
      offsetMs: Math.round((i / SAMPLE_RATE) * 1000),
    });
  }
  return chunks;
}
