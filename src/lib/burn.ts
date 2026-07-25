"use client";

import type { Cue, FormatProfile } from "./types";

/**
 * Incrustation (« burn ») des sous-titres dans la vidéo, entièrement dans
 * le navigateur : la vidéo est rejouée sur un canvas avec les sous-titres
 * dessinés par-dessus, et le tout est réenregistré (MediaRecorder).
 * Rien ne quitte la machine. Rendu en temps réel (durée ≈ durée vidéo).
 */

/** Cue actif à un instant donné (ms). */
export function cueAt(cues: Cue[], timeMs: number): Cue | null {
  for (const c of cues) {
    if (timeMs >= c.startMs && timeMs < c.endMs) return c;
  }
  return null;
}

export interface MimeChoice {
  mimeType: string;
  extension: "mp4" | "webm";
}

/** Choisit le meilleur format supporté par le navigateur (MP4 si possible). */
export function pickMimeType(isSupported: (mime: string) => boolean): MimeChoice | null {
  const candidates: MimeChoice[] = [
    { mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', extension: "mp4" },
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
  ];
  for (const c of candidates) {
    if (isSupported(c.mimeType)) return c;
  }
  return null;
}

export interface BurnResult {
  blob: Blob;
  extension: "mp4" | "webm";
}

export async function burnSubtitles(
  file: File,
  cues: Cue[],
  profile: FormatProfile,
  onProgress: (percent: number) => void
): Promise<BurnResult> {
  const choice = pickMimeType((m) => MediaRecorder.isTypeSupported(m));
  if (!choice) throw new Error("Ce navigateur ne supporte pas l'enregistrement vidéo.");

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Impossible de lire cette vidéo."));
  });
  if (!video.videoWidth) throw new Error("Ce fichier n'a pas de piste vidéo.");

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible.");

  // Les métriques du profil sont exprimées pour son canvas de référence :
  // on les met à l'échelle de la vidéo réelle.
  const scale = canvas.width / profile.canvasWidth;
  const fontPx = profile.fontSizePx * scale;
  await document.fonts.load(`${profile.fontWeight} ${fontPx}px "${profile.fontFamily}"`).catch(() => {});

  // Audio capturé silencieusement via AudioContext (pas de haut-parleurs).
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaElementSource(video);
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);

  const canvasStream = canvas.captureStream(30);
  const tracks = [...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const recorder = new MediaRecorder(new MediaStream(tracks), {
    mimeType: choice.mimeType,
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);

  const drawFrame = () => {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const cue = cueAt(sorted, video.currentTime * 1000);
    if (!cue) return;
    const lines = cue.formattedLines.length > 0 ? cue.formattedLines : cue.correctedText.split("\n");

    ctx.font = `${profile.fontWeight} ${fontPx}px "${profile.fontFamily}", Arial, sans-serif`;
    if ("letterSpacing" in ctx) {
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
        `${profile.trackingEm * fontPx}px`;
    }
    ctx.textAlign = profile.align === "left" ? "left" : profile.align === "right" ? "right" : "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetY = 2 * scale;
    ctx.fillStyle = "#ffffff";

    const lineHeight = fontPx * profile.lineHeight;
    const centerY = (profile.positionYPercent / 100) * canvas.height;
    const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
    const x =
      profile.align === "left"
        ? profile.safeMarginX * scale
        : profile.align === "right"
          ? canvas.width - profile.safeMarginX * scale
          : canvas.width / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, x, startY + i * lineHeight);
    });
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  };

  return await new Promise<BurnResult>((resolve, reject) => {
    let raf = 0;
    const loop = () => {
      drawFrame();
      onProgress(Math.min(99, (video.currentTime / video.duration) * 100));
      raf = requestAnimationFrame(loop);
    };

    recorder.onstop = () => {
      cancelAnimationFrame(raf);
      URL.revokeObjectURL(url);
      void audioCtx.close();
      onProgress(100);
      resolve({ blob: new Blob(chunks, { type: choice.mimeType }), extension: choice.extension });
    };
    recorder.onerror = () => reject(new Error("Échec de l'enregistrement vidéo."));
    video.onended = () => {
      // Dernière frame puis arrêt (petit délai pour vider le buffer).
      drawFrame();
      setTimeout(() => recorder.stop(), 200);
    };

    recorder.start(500);
    void video.play().then(() => loop()).catch(() => reject(new Error("Lecture vidéo impossible.")));
  });
}
