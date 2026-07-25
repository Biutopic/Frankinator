"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFrankinator, glossaryList } from "@/lib/store";
import type { Cue, CorrectionOptions } from "@/lib/types";
import { correctBatch, getBrowserKey, setBrowserKey } from "@/lib/correction/client";
import { applyFrenchTypography } from "@/lib/text/typography";
import { stripHesitations } from "@/lib/text/hesitations";
import DiffText from "../DiffText";
import Frank from "../Frank";

const BATCH_SIZE = 20;

const TOGGLES: { key: keyof CorrectionOptions; label: string }[] = [
  { key: "spelling", label: "Corriger l'orthographe" },
  { key: "punctuation", label: "Corriger la ponctuation" },
  { key: "frenchTypography", label: "Appliquer la typographie française" },
  { key: "transcriptionErrors", label: "Corriger les erreurs de transcription" },
  { key: "properNames", label: "Corriger les noms propres" },
  { key: "useGlossary", label: "Utiliser le glossaire" },
  { key: "strictConjugations", label: "Conserver strictement les conjugaisons" },
  { key: "keepHesitations", label: "Conserver les hésitations" },
  { key: "removeHesitations", label: "Supprimer les hésitations" },
  { key: "keepRepetitions", label: "Conserver les répétitions" },
  { key: "removeAccidentalRepetitions", label: "Supprimer les répétitions accidentelles" },
  { key: "smallNumbersAsWords", label: "Écrire les petits nombres en lettres" },
  { key: "normalizeUnits", label: "Normaliser les unités" },
  { key: "normalizeTimes", label: "Normaliser les heures" },
];

type Filter = "all" | "modified" | "warnings";

/** Étape 2 — Corriger : correction IA + revue manuelle complète. */
export default function CorrectStep() {
  const s = useFrankinator();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [apiKey, setApiKey] = useState("");
  // Rendu client uniquement (dynamic ssr:false) : lecture directe possible.
  const [hasBrowserKey, setHasBrowserKey] = useState(() => Boolean(getBrowserKey()));
  const [needsKey, setNeedsKey] = useState(false);

  const runCorrection = useCallback(async () => {
    setRunning(true);
    setError(null);
    const cues = s.cues;
    const candidates = cues.filter((c) => !c.isLocked && c.correctedText.trim() !== "");
    const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
    let updated = [...cues];
    const problems: string[] = [];

    try {
      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        setProgress(`Correction ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length}…`);

        const firstIdx = sorted.findIndex((c) => c.id === batch[0].id);
        const lastIdx = sorted.findIndex((c) => c.id === batch[batch.length - 1].id);
        const contextBefore = sorted.slice(Math.max(0, firstIdx - 3), firstIdx).map((c) => c.correctedText).join("\n");
        const contextAfter = sorted.slice(lastIdx + 1, lastIdx + 4).map((c) => c.correctedText).join("\n");

        const result = await correctBatch({
          cues: batch.map((c) => ({ id: c.id, text: c.correctedText })),
          contextBefore,
          contextAfter,
          videoContext: s.videoContext,
          glossary: glossaryList(s.glossaryText),
          referenceTranscript: s.referenceTranscript,
          language: s.language,
          options: s.options as unknown as Record<string, boolean | string>,
        });

        problems.push(...result.problems);
        const byId = new Map(result.corrections.map((c) => [c.id, c]));
        updated = updated.map((cue) => {
          const corr = byId.get(cue.id);
          if (!corr || cue.isLocked) return cue;
          let text = corr.correctedText;
          // La typographie française déterministe est appliquée localement
          // en plus de la correction IA (mêmes règles, résultat stable).
          if (s.options.frenchTypography) text = applyFrenchTypography(text);
          const changed = text !== cue.correctedText;
          return {
            ...cue,
            proposedText: changed ? text : null,
            proposedConfidence: corr.confidence,
            reviewState: changed ? "pending" : "untouched",
            warnings: corr.warning
              ? [...cue.warnings.filter((w) => !w.startsWith("[ia]")), `[ia] ${corr.warning}`]
              : cue.warnings.filter((w) => !w.startsWith("[ia]")),
          } as Cue;
        });
        s.setCues(updated, i === 0);
      }
      if (problems.length > 0) setError(problems.join(" — "));
      setNeedsKey(false);
    } catch (e) {
      const err = e as Error & { code?: string };
      setError(err.message);
      if (err.code === "missing_api_key") setNeedsKey(true);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [s]);

  const applyLocalTypography = useCallback(() => {
    s.setCues(
      s.cues.map((c) =>
        c.isLocked ? c : { ...c, correctedText: applyFrenchTypography(c.correctedText) }
      )
    );
  }, [s]);

  // Un clic, sans IA : retire « euh / heu / hum… » de tous les cues
  // non verrouillés (annulable avec Ctrl+Z).
  const removeHeu = useCallback(() => {
    s.setCues(
      s.cues.map((c) => {
        if (c.isLocked) return c;
        const cleaned = stripHesitations(c.correctedText);
        if (cleaned === c.correctedText) return c;
        return {
          ...c,
          correctedText: cleaned,
          formattedLines: [],
          reviewState: "edited" as const,
          warnings:
            cleaned.trim() === ""
              ? [...c.warnings, "Cue vidé par la suppression des hésitations : fusion ou suppression recommandée."]
              : c.warnings,
        };
      })
    );
  }, [s]);

  const accept = useCallback(
    (cue: Cue) => {
      if (cue.proposedText === null) return;
      s.updateCue(cue.id, {
        correctedText: cue.proposedText,
        proposedText: null,
        reviewState: "accepted",
      });
    },
    [s]
  );
  const reject = useCallback(
    (cue: Cue) => {
      s.updateCue(cue.id, { proposedText: null, reviewState: "rejected" });
    },
    [s]
  );
  const restoreOriginal = useCallback(
    (cue: Cue) => {
      s.updateCue(cue.id, {
        correctedText: cue.originalText,
        proposedText: null,
        reviewState: "rejected",
      });
    },
    [s]
  );
  const toggleLock = useCallback(
    (cue: Cue) => s.updateCue(cue.id, { isLocked: !cue.isLocked }),
    [s]
  );

  const acceptAllSafe = useCallback(() => {
    s.setCues(
      s.cues.map((c) =>
        c.proposedText !== null && c.proposedConfidence === "high" && !c.isLocked
          ? { ...c, correctedText: c.proposedText, proposedText: null, reviewState: "accepted" as const }
          : c
      )
    );
  }, [s]);

  const rejectAll = useCallback(() => {
    s.setCues(
      s.cues.map((c) =>
        c.proposedText !== null ? { ...c, proposedText: null, reviewState: "rejected" as const } : c
      )
    );
  }, [s]);

  const doReplace = useCallback(() => {
    if (!search) return;
    s.setCues(
      s.cues.map((c) =>
        c.isLocked ? c : { ...c, correctedText: c.correctedText.split(search).join(replace) }
      )
    );
  }, [s, search, replace]);

  const visible = useMemo(() => {
    let list = [...s.cues].sort((a, b) => a.startMs - b.startMs);
    if (filter === "modified")
      list = list.filter((c) => c.proposedText !== null || c.correctedText !== c.originalText);
    if (filter === "warnings") list = list.filter((c) => c.warnings.length > 0);
    if (search) list = list.filter((c) => c.correctedText.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [s.cues, filter, search]);

  // Raccourcis clavier : ↑/↓ naviguer, A accepter, R rejeter, L verrouiller, Ctrl+Z/Y.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
        if (e.ctrlKey && e.key === "z") return; // laisser l'undo natif des champs
        return;
      }
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        s.undo();
        return;
      }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
        e.preventDefault();
        s.redo();
        return;
      }
      const cue = visible[selectedIdx];
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (cue && (e.key === "a" || e.key === "A")) {
        accept(cue);
      } else if (cue && (e.key === "r" || e.key === "R")) {
        reject(cue);
      } else if (cue && (e.key === "l" || e.key === "L")) {
        toggleLock(cue);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, selectedIdx, accept, reject, toggleLock, s]);

  const pendingCount = s.cues.filter((c) => c.proposedText !== null).length;

  return (
    <div className="space-y-4">
      <section className="border border-zinc-800 rounded-xl p-4">
        <h2 className="font-bold mb-3">Options de correction</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {TOGGLES.map((t) => (
            <label key={t.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(s.options[t.key])}
                onChange={(e) => {
                  const patch: Partial<CorrectionOptions> = { [t.key]: e.target.checked };
                  // Options mutuellement exclusives.
                  if (t.key === "removeHesitations" && e.target.checked) patch.keepHesitations = false;
                  if (t.key === "keepHesitations" && e.target.checked) patch.removeHesitations = false;
                  s.setOptions(patch);
                }}
                className="accent-green-500"
              />
              {t.label}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-3 text-sm">
          <span className="font-semibold">Niveau :</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              checked={s.options.mode === "minimal"}
              onChange={() => s.setOptions({ mode: "minimal" })}
              className="accent-green-500"
            />
            Correction minimale
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              checked={s.options.mode === "standard"}
              onChange={() => s.setOptions({ mode: "standard" })}
              className="accent-green-500"
            />
            Correction standard
          </label>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={runCorrection}
            disabled={running || s.cues.length === 0}
            className="px-5 py-2 bg-green-500 text-zinc-950 rounded-lg font-bold disabled:opacity-40"
          >
            {running ? (progress ?? "Correction en cours…") : "Lancer la correction IA"}
          </button>
          {running && <Frank kind="pense" anim="think" size={52} title="Frank réfléchit…" />}
          <button
            onClick={applyLocalTypography}
            disabled={running}
            className="px-4 py-2 bg-zinc-700 rounded-lg font-semibold text-sm hover:bg-zinc-600"
          >
            Typographie française seule (sans IA)
          </button>
          <button
            onClick={removeHeu}
            disabled={running || s.cues.length === 0}
            title="Retire euh, heu, hum… de tous les sous-titres non verrouillés. Annulable (Ctrl+Z)."
            className="px-4 py-2 bg-zinc-700 rounded-lg font-semibold text-sm hover:bg-zinc-600 disabled:opacity-40"
          >
            Supprimer les « euh » (1 clic, sans IA)
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-amber-400">⚠️ {error}</p>}

        {needsKey && (
          <div className="mt-3 border border-amber-700 rounded-lg p-3 text-sm">
            <p className="mb-2">
              Aucune clé serveur configurée. Vous pouvez saisir votre clé API Anthropic : elle sera
              stockée <strong>uniquement dans votre navigateur</strong> et envoyée directement à
              l&apos;API Anthropic (jamais à un autre serveur).
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-…"
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg p-2"
              />
              <button
                onClick={() => {
                  setBrowserKey(apiKey.trim() || null);
                  setHasBrowserKey(Boolean(apiKey.trim()));
                  setApiKey("");
                  setNeedsKey(false);
                }}
                className="px-3 py-2 bg-zinc-700 rounded-lg font-semibold hover:bg-zinc-600"
              >
                Enregistrer
              </button>
            </div>
          </div>
        )}
        {hasBrowserKey && (
          <p className="mt-2 text-xs text-zinc-500">
            Clé API navigateur enregistrée.{" "}
            <button
              onClick={() => {
                setBrowserKey(null);
                setHasBrowserKey(false);
              }}
              className="underline hover:text-zinc-300"
            >
              Supprimer la clé
            </button>
          </p>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={acceptAllSafe}
          disabled={pendingCount === 0}
          className="px-3 py-1.5 bg-green-600 rounded-lg font-semibold disabled:opacity-40"
        >
          Accepter toutes les corrections sûres
        </button>
        <button
          onClick={rejectAll}
          disabled={pendingCount === 0}
          className="px-3 py-1.5 bg-zinc-700 rounded-lg font-semibold disabled:opacity-40"
        >
          Tout rejeter
        </button>
        <button onClick={s.undo} disabled={s.past.length === 0} className="px-3 py-1.5 bg-zinc-800 rounded-lg disabled:opacity-40">
          ↶ Annuler
        </button>
        <button onClick={s.redo} disabled={s.future.length === 0} className="px-3 py-1.5 bg-zinc-800 rounded-lg disabled:opacity-40">
          ↷ Rétablir
        </button>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg p-1.5"
        >
          <option value="all">Tous les sous-titres</option>
          <option value="modified">Modifiés uniquement</option>
          <option value="warnings">Avec avertissements</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          className="bg-zinc-900 border border-zinc-700 rounded-lg p-1.5 w-36"
        />
        <input
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          placeholder="Remplacer par…"
          className="bg-zinc-900 border border-zinc-700 rounded-lg p-1.5 w-36"
        />
        <button onClick={doReplace} disabled={!search} className="px-3 py-1.5 bg-zinc-700 rounded-lg disabled:opacity-40">
          Remplacer tout
        </button>
        <span className="text-zinc-500 ml-auto">
          Raccourcis : ↑↓ naviguer · A accepter · R rejeter · L verrouiller · Ctrl+Z/Y
        </span>
      </section>

      <section className="space-y-2">
        {visible.map((cue, idx) => (
          <article
            key={cue.id}
            onClick={() => setSelectedIdx(idx)}
            className={`border rounded-lg p-3 text-sm cursor-pointer ${
              idx === selectedIdx ? "border-green-500" : "border-zinc-800"
            } ${cue.isLocked ? "opacity-70" : ""}`}
          >
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
              <span className="font-mono">#{cue.id}</span>
              {cue.isLocked && <span className="text-amber-400">🔒 verrouillé</span>}
              {cue.proposedConfidence === "low" && cue.proposedText !== null && (
                <span className="text-amber-400">confiance faible</span>
              )}
              {cue.reviewState === "accepted" && <span className="text-green-400">✓ accepté</span>}
              {cue.reviewState === "rejected" && <span className="text-zinc-400">rejeté</span>}
              {cue.warnings.map((w, i) => (
                <span key={i} className="text-amber-400">⚠ {w}</span>
              ))}
            </div>

            {editingId === cue.id ? (
              <div>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={2}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2"
                  autoFocus
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => {
                      s.updateCue(cue.id, {
                        correctedText: editText,
                        proposedText: null,
                        reviewState: "edited",
                      });
                      setEditingId(null);
                    }}
                    className="px-3 py-1 bg-green-600 rounded font-semibold"
                  >
                    Enregistrer
                  </button>
                  <button onClick={() => setEditingId(null)} className="px-3 py-1 bg-zinc-700 rounded">
                    Annuler
                  </button>
                </div>
              </div>
            ) : cue.proposedText !== null ? (
              <div className="space-y-1">
                <DiffText from={cue.correctedText} to={cue.proposedText} />
              </div>
            ) : (
              <div className="whitespace-pre-wrap">
                {cue.correctedText !== cue.originalText ? (
                  <DiffText from={cue.originalText} to={cue.correctedText} />
                ) : (
                  cue.correctedText || <em className="text-zinc-500">(vide)</em>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 mt-2">
              {cue.proposedText !== null && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); accept(cue); }} className="px-2.5 py-1 bg-green-600 rounded text-xs font-semibold">
                    Accepter
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); reject(cue); }} className="px-2.5 py-1 bg-zinc-700 rounded text-xs font-semibold">
                    Rejeter
                  </button>
                </>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(cue.id);
                  setEditText(cue.proposedText ?? cue.correctedText);
                }}
                className="px-2.5 py-1 bg-zinc-800 rounded text-xs"
              >
                Modifier
              </button>
              <button onClick={(e) => { e.stopPropagation(); toggleLock(cue); }} className="px-2.5 py-1 bg-zinc-800 rounded text-xs">
                {cue.isLocked ? "Déverrouiller" : "Verrouiller"}
              </button>
              <button onClick={(e) => { e.stopPropagation(); restoreOriginal(cue); }} className="px-2.5 py-1 bg-zinc-800 rounded text-xs">
                Restaurer l&apos;original
              </button>
            </div>
          </article>
        ))}
      </section>

      <div className="flex justify-end">
        <button
          onClick={() => s.setStep("format")}
          className="px-5 py-2 bg-green-500 text-zinc-950 rounded-lg font-bold"
        >
          Continuer vers le formatage →
        </button>
      </div>
    </div>
  );
}
