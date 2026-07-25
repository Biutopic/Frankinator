"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrankinator, glossaryList } from "@/lib/store";
import type { Cue } from "@/lib/types";
import { formatTimecode, parseTimecode } from "@/lib/srt/timecode";
import { breakIntoLines } from "@/lib/format/linebreak";
import { formatAllCues } from "@/lib/format/formatter";
import { mergeCues } from "@/lib/format/merge";
import { words } from "@/lib/text/tokenize";
import { useMeasurer } from "../useMeasurer";

/** Étape 4 — Vérifier : aperçu visuel exact + timeline éditable. */
export default function VerifyStep() {
  const s = useFrankinator();
  const profile = s.profiles.find((p) => p.id === s.activeProfileId) ?? s.profiles[0];
  const { measurer, ready, fontFallback } = useMeasurer(profile);

  const sorted = useMemo(() => [...s.cues].sort((a, b) => a.startMs - b.startMs), [s.cues]);
  const [currentIdx, setCurrentIdx] = useState(0);

  // Formatage automatique par défaut : si des cues n'ont pas encore de
  // lignes calculées (import récent, texte édité…), la découpe et les
  // scissions sont appliquées dès l'arrivée sur cette étape.
  const autoFormatted = useRef(false);
  useEffect(() => {
    if (!ready || autoFormatted.current) return;
    const stale = s.cues.some(
      (c) => !c.isLocked && c.formattedLines.length === 0 && c.correctedText.trim() !== ""
    );
    if (!stale) return;
    autoFormatted.current = true;
    const r = formatAllCues(
      s.cues,
      profile,
      measurer,
      glossaryList(s.customProtectedText),
      glossaryList(s.glossaryText)
    );
    s.setCues(r.cues, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(sorted[0]?.startMs ?? 0);
  // La vidéo transcrite est le fond d'aperçu par défaut (lecture synchronisée).
  const [bg, setBg] = useState<{ url: string; kind: "image" | "video"; isProjectMedia?: boolean } | null>(() =>
    s.mediaFile ? { url: URL.createObjectURL(s.mediaFile), kind: "video", isProjectMedia: true } : null
  );
  const [bgColor, setBgColor] = useState("#18181b");
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [showWidthBounds, setShowWidthBounds] = useState(true);
  const [dragging, setDragging] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const current = sorted[currentIdx] ?? null;

  // Lecture : avance le playhead en temps réel et suit les timecodes.
  const playheadRef = useRef(playheadMs);
  const setPlayhead = useCallback((ms: number) => {
    playheadRef.current = ms;
    setPlayheadMs(ms);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // Vidéo du projet présente : elle est l'horloge de référence.
      const media = videoRef.current;
      const t =
        bg?.isProjectMedia && media ? media.currentTime * 1000 : playheadRef.current + (now - last);
      last = now;
      setPlayhead(t);
      const idx = sorted.findIndex((c) => t >= c.startMs && t < c.endMs);
      if (idx >= 0) setCurrentIdx(idx);
      const lastCue = sorted[sorted.length - 1];
      if (lastCue && t > lastCue.endMs) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, sorted, setPlayhead, bg?.isProjectMedia]);

  // Pilotage de la vidéo du projet : lecture/pause avec l'aperçu, son actif.
  useEffect(() => {
    const media = videoRef.current;
    if (!bg?.isProjectMedia || !media) return;
    if (playing) {
      media.currentTime = playheadRef.current / 1000;
      media.muted = false;
      void media.play().catch(() => {});
    } else {
      media.pause();
    }
  }, [playing, bg?.isProjectMedia]);

  // Navigation manuelle : cale la vidéo sur le début du cue sélectionné.
  useEffect(() => {
    const media = videoRef.current;
    if (playing || !bg?.isProjectMedia || !media) return;
    const cue = sorted[currentIdx];
    if (cue) media.currentTime = cue.startMs / 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, bg?.isProjectMedia]);

  const activeCue = playing
    ? sorted.find((c) => playheadMs >= c.startMs && playheadMs < c.endMs) ?? null
    : current;

  // Échelle d'aperçu : le canvas du profil est rendu dans ~340 px de large.
  const previewWidth = 340;
  const scale = previewWidth / profile.canvasWidth;
  const previewHeight = profile.canvasHeight * scale;

  const lines =
    activeCue &&
    (activeCue.formattedLines.length > 0
      ? activeCue.formattedLines
      : breakIntoLines(activeCue.correctedText, {
          measurer,
          maxWidthPx: profile.maxTextWidth,
          maxLines: profile.maxLines,
          customProtected: glossaryList(s.customProtectedText),
          glossary: glossaryList(s.glossaryText),
        }).lines);

  const overflowing =
    ready && lines ? lines.some((l) => measurer.measure(l) > profile.maxTextWidth * 1.001) : false;

  // Le texte n'est JAMAIS masqué hors cadre : si une ligne dépasse malgré
  // tout (cue impossible à découper), l'aperçu la réduit pour qu'elle
  // reste entièrement visible, et l'alerte rouge reste affichée.
  const fitFactor = useMemo(() => {
    if (!ready || !lines || lines.length === 0) return 1;
    const maxW = Math.max(...lines.map((l) => measurer.measure(l)));
    return maxW > profile.maxTextWidth ? profile.maxTextWidth / maxW : 1;
  }, [ready, lines, measurer, profile.maxTextWidth]);

  const onDragPosition = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      const pct = Math.min(95, Math.max(5, ((e.clientY - rect.top) / rect.height) * 100));
      s.upsertProfile({ ...profile, positionYPercent: Math.round(pct) });
    },
    [dragging, profile, s]
  );

  const uploadBg = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setBg({ url, kind: file.type.startsWith("video") ? "video" : "image" });
  }, []);

  // --- Édition timeline ---

  const updateTiming = useCallback(
    (cue: Cue, field: "startMs" | "endMs", raw: string) => {
      const ms = parseTimecode(raw);
      if (ms === null) return;
      const others = s.cues.filter((c) => c.id !== cue.id);
      const next = { ...cue, [field]: ms };
      if (next.startMs >= next.endMs) {
        alert("Le début doit être avant la fin.");
        return;
      }
      const overlap = others.find((c) => next.startMs < c.endMs && next.endMs > c.startMs && c.id !== cue.id);
      if (overlap && !confirm(`Chevauchement avec le cue #${overlap.id}. Appliquer quand même ?`)) return;
      s.updateCue(cue.id, { [field]: ms });
    },
    [s]
  );

  const splitAtCursor = useCallback(
    (cue: Cue, charIndex: number) => {
      const text = cue.correctedText;
      if (charIndex <= 0 || charIndex >= text.length) return;
      // Coupe à la frontière de mot la plus proche.
      let pos = charIndex;
      while (pos > 0 && !/\s/.test(text[pos - 1]) && !/\s/.test(text[pos] ?? " ")) pos--;
      const left = text.slice(0, pos).trim();
      const right = text.slice(pos).trim();
      if (!left || !right) return;
      const ratio = left.length / (left.length + right.length);
      const mid = Math.round(cue.startMs + (cue.endMs - cue.startMs) * ratio);
      const nextId = Math.max(...s.cues.map((c) => c.id)) + 1;
      const a: Cue = { ...cue, correctedText: left, endMs: mid, formattedLines: [], reviewState: "edited" };
      const b: Cue = {
        ...cue,
        id: nextId,
        correctedText: right,
        startMs: mid,
        originalText: "",
        formattedLines: [],
        splitFrom: cue.id,
        reviewState: "edited",
      };
      s.setCues(s.cues.flatMap((c) => (c.id === cue.id ? [a, b] : [c])));
    },
    [s]
  );

  const splitAtPlayhead = useCallback(
    (cue: Cue) => {
      if (playheadMs <= cue.startMs || playheadMs >= cue.endMs) {
        alert("Placez la tête de lecture à l'intérieur du cue.");
        return;
      }
      const ratio = (playheadMs - cue.startMs) / (cue.endMs - cue.startMs);
      const wordList = words(cue.correctedText);
      const cutWord = Math.max(1, Math.min(wordList.length - 1, Math.round(wordList.length * ratio)));
      // Retrouve l'index caractère du mot de coupe.
      let count = 0;
      let charIdx = 0;
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(cue.correctedText)) !== null) {
        count++;
        if (count === cutWord + 1) {
          charIdx = m.index;
          break;
        }
      }
      if (charIdx > 0) splitAtCursor(cue, charIdx);
    },
    [playheadMs, splitAtCursor]
  );

  const mergeWith = useCallback(
    (cue: Cue, direction: -1 | 1) => {
      const idx = sorted.findIndex((c) => c.id === cue.id);
      const other = sorted[idx + direction];
      if (!other) return;
      const [a, b] = direction === 1 ? [cue, other] : [other, cue];
      const merged = mergeCues(a, b);
      s.setCues(s.cues.filter((c) => c.id !== b.id).map((c) => (c.id === a.id ? merged : c)));
    },
    [s, sorted]
  );

  const moveWord = useCallback(
    (cue: Cue, direction: "lastToNext" | "firstToPrev") => {
      const idx = sorted.findIndex((c) => c.id === cue.id);
      if (direction === "lastToNext") {
        const next = sorted[idx + 1];
        if (!next) return;
        const w = cue.correctedText.trim().match(/\S+$/)?.[0];
        if (!w || cue.correctedText.trim() === w) return;
        s.setCues(
          s.cues.map((c) => {
            if (c.id === cue.id)
              return { ...c, correctedText: cue.correctedText.trim().slice(0, -w.length).trim(), formattedLines: [] };
            if (c.id === next.id) return { ...c, correctedText: `${w} ${next.correctedText.trim()}`, formattedLines: [] };
            return c;
          })
        );
      } else {
        const prev = sorted[idx - 1];
        if (!prev) return;
        const w = cue.correctedText.trim().match(/^\S+/)?.[0];
        if (!w || cue.correctedText.trim() === w) return;
        s.setCues(
          s.cues.map((c) => {
            if (c.id === cue.id)
              return { ...c, correctedText: cue.correctedText.trim().slice(w.length).trim(), formattedLines: [] };
            if (c.id === prev.id) return { ...c, correctedText: `${prev.correctedText.trim()} ${w}`, formattedLines: [] };
            return c;
          })
        );
      }
    },
    [s, sorted]
  );

  const recalcLines = useCallback(
    (cue: Cue) => {
      const r = breakIntoLines(cue.correctedText, {
        measurer,
        maxWidthPx: profile.maxTextWidth,
        maxLines: profile.maxLines,
        customProtected: glossaryList(s.customProtectedText),
        glossary: glossaryList(s.glossaryText),
      });
      s.updateCue(cue.id, {
        formattedLines: r.lines,
        warnings: r.overflow
          ? [...cue.warnings.filter((w) => !w.startsWith("[format]")), "[format] Ne tient pas dans le nombre de lignes."]
          : cue.warnings.filter((w) => !w.startsWith("[format]")),
      });
    },
    [s, measurer, profile]
  );

  if (sorted.length === 0)
    return <p className="text-zinc-400">Importez d&apos;abord un fichier SRT.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* ------ Aperçu ------ */}
      <aside className="space-y-3">
        <div
          ref={previewRef}
          onPointerMove={onDragPosition}
          onPointerUp={() => setDragging(false)}
          onPointerLeave={() => setDragging(false)}
          className="relative mx-auto rounded-xl overflow-hidden border border-zinc-700 select-none"
          style={{ width: previewWidth, height: previewHeight, background: bgColor }}
        >
          {bg?.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bg.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
          )}
          {bg?.kind === "video" && (
            <video
              ref={videoRef}
              src={bg.url}
              className="absolute inset-0 w-full h-full object-cover"
              muted={!bg.isProjectMedia}
              loop={!bg.isProjectMedia}
              autoPlay={!bg.isProjectMedia}
              playsInline
              preload="auto"
            />
          )}

          {showSafeZones && (
            <div
              className="absolute inset-y-0 border-x border-dashed border-cyan-400/50 pointer-events-none"
              style={{ left: profile.safeMarginX * scale, right: profile.safeMarginX * scale }}
            />
          )}
          {showWidthBounds && (
            <div
              className="absolute inset-y-0 border-x border-dashed border-amber-400/50 pointer-events-none"
              style={{
                left: (profile.canvasWidth - profile.maxTextWidth) / 2 * scale,
                right: (profile.canvasWidth - profile.maxTextWidth) / 2 * scale,
              }}
            />
          )}
          {showGuides && (
            <div className="absolute left-1/2 inset-y-0 w-px bg-fuchsia-400/40 pointer-events-none" />
          )}

          {lines && lines.length > 0 && (
            <div
              onPointerDown={() => setDragging(true)}
              className="absolute w-full cursor-grab active:cursor-grabbing"
              style={{
                top: `${profile.positionYPercent}%`,
                transform: "translateY(-50%)",
                textAlign: profile.align,
                paddingLeft: profile.safeMarginX * scale,
                paddingRight: profile.safeMarginX * scale,
              }}
            >
              {lines.map((l, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: `"${measurer.effectiveFamily}", Arial, sans-serif`,
                    fontWeight: profile.fontWeight,
                    fontSize: profile.fontSizePx * scale * fitFactor,
                    letterSpacing: `${profile.trackingEm}em`,
                    lineHeight: profile.lineHeight,
                    color: "#fff",
                    textShadow: "0 2px 8px rgba(0,0,0,0.8)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {l}
                </div>
              ))}
            </div>
          )}

          {overflowing && (
            <div className="absolute top-2 left-2 right-2 bg-red-600/90 text-white text-xs font-bold rounded p-1.5 text-center">
              ⚠️ Dépassement de largeur détecté
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm justify-center">
          <button
            onClick={() => {
              setCurrentIdx((i) => Math.max(0, i - 1));
              setPlaying(false);
            }}
            className="px-3 py-1.5 bg-zinc-800 rounded-lg"
          >
            ← Préc.
          </button>
          <button
            onClick={() => {
              if (!playing && current) setPlayhead(current.startMs);
              setPlaying(!playing);
            }}
            className="px-4 py-1.5 bg-green-600 rounded-lg font-bold"
          >
            {playing ? "⏸ Pause" : "▶ Lire"}
          </button>
          <button
            onClick={() => {
              setCurrentIdx((i) => Math.min(sorted.length - 1, i + 1));
              setPlaying(false);
            }}
            className="px-3 py-1.5 bg-zinc-800 rounded-lg"
          >
            Suiv. →
          </button>
          <span className="text-xs text-zinc-500 font-mono w-full text-center">
            {activeCue ? `#${activeCue.id} — ${formatTimecode(activeCue.startMs)} → ${formatTimecode(activeCue.endMs)}` : "—"}
            {playing && ` · ${formatTimecode(playheadMs)}`}
          </span>
        </div>

        <div className="border border-zinc-800 rounded-xl p-3 text-sm space-y-2">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showSafeZones} onChange={(e) => setShowSafeZones(e.target.checked)} className="accent-green-500" />
              Zones de sécurité
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showWidthBounds} onChange={(e) => setShowWidthBounds(e.target.checked)} className="accent-green-500" />
              Limites de largeur
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} className="accent-green-500" />
              Guides centraux
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label className="px-2.5 py-1.5 bg-zinc-800 rounded-lg cursor-pointer">
              Image / vidéo d&apos;aperçu…
              <input
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadBg(f);
                  e.target.value = "";
                }}
              />
            </label>
            {bg && (
              <button onClick={() => setBg(null)} className="px-2.5 py-1.5 bg-zinc-800 rounded-lg">
                Retirer
              </button>
            )}
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              title="Couleur de fond"
              className="w-9 h-9 bg-transparent cursor-pointer"
            />
          </div>
          <p className="text-xs text-zinc-500">
            Glissez le texte verticalement pour régler sa position ({profile.positionYPercent} %).
            Le média d&apos;aperçu reste local, il n&apos;est jamais envoyé à Claude.
            {fontFallback && " ⚠️ Police de repli utilisée."}
          </p>
        </div>
      </aside>

      {/* ------ Timeline ------ */}
      <section className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
        {sorted.map((cue, idx) => (
          <TimelineRow
            key={cue.id}
            cue={cue}
            selected={idx === currentIdx}
            onSelect={() => {
              setCurrentIdx(idx);
              setPlaying(false);
            }}
            onTiming={updateTiming}
            onText={(text) => s.updateCue(cue.id, { correctedText: text, formattedLines: [], reviewState: "edited" })}
            onSplitCursor={(pos) => splitAtCursor(cue, pos)}
            onSplitPlayhead={() => splitAtPlayhead(cue)}
            onMergePrev={() => mergeWith(cue, -1)}
            onMergeNext={() => mergeWith(cue, 1)}
            onMoveLast={() => moveWord(cue, "lastToNext")}
            onMoveFirst={() => moveWord(cue, "firstToPrev")}
            onRecalc={() => recalcLines(cue)}
            onLock={() => s.updateCue(cue.id, { isLocked: !cue.isLocked })}
            onRestoreTiming={() => s.updateCue(cue.id, { startMs: cue.originalStartMs, endMs: cue.originalEndMs })}
            onRestoreText={() =>
              cue.originalText &&
              s.updateCue(cue.id, { correctedText: cue.originalText, formattedLines: [], reviewState: "rejected" })
            }
          />
        ))}
        <div className="flex justify-end pt-2">
          <button onClick={() => s.setStep("export")} className="px-5 py-2 bg-green-500 text-zinc-950 rounded-lg font-bold">
            Continuer vers l&apos;export →
          </button>
        </div>
      </section>
    </div>
  );
}

function TimelineRow(props: {
  cue: Cue;
  selected: boolean;
  onSelect: () => void;
  onTiming: (cue: Cue, field: "startMs" | "endMs", raw: string) => void;
  onText: (text: string) => void;
  onSplitCursor: (pos: number) => void;
  onSplitPlayhead: () => void;
  onMergePrev: () => void;
  onMergeNext: () => void;
  onMoveLast: () => void;
  onMoveFirst: () => void;
  onRecalc: () => void;
  onLock: () => void;
  onRestoreTiming: () => void;
  onRestoreText: () => void;
}) {
  const { cue } = props;
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [start, setStart] = useState(formatTimecode(cue.startMs));
  const [end, setEnd] = useState(formatTimecode(cue.endMs));
  // Synchronisation d'état dérivé pendant le rendu (motif React recommandé).
  const [prevTiming, setPrevTiming] = useState([cue.startMs, cue.endMs]);
  if (prevTiming[0] !== cue.startMs || prevTiming[1] !== cue.endMs) {
    setPrevTiming([cue.startMs, cue.endMs]);
    setStart(formatTimecode(cue.startMs));
    setEnd(formatTimecode(cue.endMs));
  }

  return (
    <article
      onClick={props.onSelect}
      className={`border rounded-lg p-2.5 text-sm ${props.selected ? "border-green-500" : "border-zinc-800"}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <span className="text-zinc-500">#{cue.id}</span>
        <input
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onBlur={() => props.onTiming(cue, "startMs", start)}
          className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 w-32"
        />
        →
        <input
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={() => props.onTiming(cue, "endMs", end)}
          className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 w-32"
        />
        {cue.isLocked && <span className="text-amber-400">🔒</span>}
      </div>
      <textarea
        ref={textRef}
        value={cue.correctedText}
        onChange={(e) => props.onText(e.target.value)}
        rows={2}
        disabled={cue.isLocked}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 mt-1.5 disabled:opacity-60"
      />
      <div className="flex flex-wrap gap-1 mt-1.5 text-xs">
        <button
          onClick={(e) => {
            e.stopPropagation();
            props.onSplitCursor(textRef.current?.selectionStart ?? 0);
          }}
          className="px-2 py-0.5 bg-zinc-800 rounded"
          title="Coupe au curseur texte"
        >
          Scinder au curseur
        </button>
        <button onClick={(e) => { e.stopPropagation(); props.onSplitPlayhead(); }} className="px-2 py-0.5 bg-zinc-800 rounded">
          Scinder à la tête de lecture
        </button>
        <button onClick={(e) => { e.stopPropagation(); props.onMergePrev(); }} className="px-2 py-0.5 bg-zinc-800 rounded">
          Fusionner ← préc.
        </button>
        <button onClick={(e) => { e.stopPropagation(); props.onMergeNext(); }} className="px-2 py-0.5 bg-zinc-800 rounded">
          Fusionner suiv. →
        </button>
        <button onClick={(e) => { e.stopPropagation(); props.onMoveLast(); }} className="px-2 py-0.5 bg-zinc-800 rounded">
          Dernier mot → suiv.
        </button>
        <button onClick={(e) => { e.stopPropagation(); props.onMoveFirst(); }} className="px-2 py-0.5 bg-zinc-800 rounded">
          Premier mot → préc.
        </button>
        <button onClick={(e) => { e.stopPropagation(); props.onRecalc(); }} className="px-2 py-0.5 bg-zinc-800 rounded">
          Recalculer les lignes
        </button>
        <button onClick={(e) => { e.stopPropagation(); props.onLock(); }} className="px-2 py-0.5 bg-zinc-800 rounded">
          {cue.isLocked ? "Déverrouiller" : "Verrouiller"}
        </button>
        <button onClick={(e) => { e.stopPropagation(); props.onRestoreTiming(); }} className="px-2 py-0.5 bg-zinc-800 rounded">
          Timing d&apos;origine
        </button>
        <button onClick={(e) => { e.stopPropagation(); props.onRestoreText(); }} className="px-2 py-0.5 bg-zinc-800 rounded">
          Texte d&apos;origine
        </button>
      </div>
    </article>
  );
}
