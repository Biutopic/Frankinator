"use client";

import { useCallback, useMemo, useState } from "react";
import { useFrankinator, glossaryList } from "@/lib/store";
import type { FormatProfile } from "@/lib/types";
import { formatAllCues } from "@/lib/format/formatter";
import { canMerge, mergeCues } from "@/lib/format/merge";
import { readingStats, orphanIssue } from "@/lib/format/readingSpeed";
import { DEFAULT_WEAK_WORDS } from "@/lib/text/weakWords";
import { useMeasurer } from "../useMeasurer";
import { downloadFile } from "@/lib/export";

const NUMERIC_FIELDS: { key: keyof FormatProfile; label: string; step?: number }[] = [
  { key: "canvasWidth", label: "Largeur canvas (px)" },
  { key: "canvasHeight", label: "Hauteur canvas (px)" },
  { key: "maxLines", label: "Lignes visibles max" },
  { key: "positionYPercent", label: "Position verticale (%)" },
  { key: "safeMarginX", label: "Marges de sécurité (px)" },
  { key: "maxTextWidth", label: "Largeur max du texte (px)" },
  { key: "fontWeight", label: "Graisse (weight)" },
  { key: "fontSizePx", label: "Taille de police (px)" },
  { key: "trackingEm", label: "Tracking (em)", step: 0.01 },
  { key: "lineHeight", label: "Interligne", step: 0.05 },
  { key: "minCueDurationMs", label: "Durée min. d'un cue généré (ms)" },
  { key: "maxMergeGapMs", label: "Écart max de fusion (ms)" },
  { key: "maxCharsPerSecond", label: "Alerte vitesse (car./s)" },
];

/** Étape 3 — Formater : profils, découpe de lignes, découpage, fusions. */
export default function FormatStep() {
  const s = useFrankinator();
  const profile = s.profiles.find((p) => p.id === s.activeProfileId) ?? s.profiles[0];
  const { measurer, fontFallback, ready } = useMeasurer(profile);
  const [runWarnings, setRunWarnings] = useState<string[]>([]);
  const [formatted, setFormatted] = useState(false);

  const customProtected = glossaryList(s.customProtectedText);
  const glossary = glossaryList(s.glossaryText);

  const runFormat = useCallback(() => {
    const result = formatAllCues(s.cues, profile, measurer, customProtected, glossary);
    s.setCues(result.cues);
    setRunWarnings(result.warnings);
    setFormatted(true);
  }, [s, profile, measurer, customProtected, glossary]);

  const updateProfile = useCallback(
    (patch: Partial<FormatProfile>) => {
      s.upsertProfile({ ...profile, ...patch });
    },
    [s, profile]
  );

  const duplicateProfile = useCallback(() => {
    const copy: FormatProfile = {
      ...profile,
      id: `p-${Date.now()}`,
      name: `${profile.name} (copie)`,
    };
    s.upsertProfile(copy);
    s.setActiveProfile(copy.id);
  }, [s, profile]);

  const exportProfile = useCallback(() => {
    downloadFile(
      `${profile.name.replace(/[^\w-]+/g, "_")}_FRANKINATOR_PROFILE.json`,
      JSON.stringify(profile, null, 2),
      "application/json"
    );
  }, [profile]);

  const importProfile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const p = JSON.parse(String(reader.result)) as FormatProfile;
          if (!p.name || !p.canvasWidth) throw new Error("format invalide");
          p.id = `p-${Date.now()}`;
          s.upsertProfile(p);
          s.setActiveProfile(p.id);
        } catch {
          alert("Fichier de profil invalide.");
        }
      };
      reader.readAsText(file);
    },
    [s]
  );

  const sorted = useMemo(() => [...s.cues].sort((a, b) => a.startMs - b.startMs), [s.cues]);

  const mergeSuggestions = useMemo(() => {
    if (!formatted) return [];
    const out: { a: number; b: number; reason: string | null; ok: boolean }[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const stats = readingStats(sorted[i], measurer, profile.maxTextWidth);
      const orphan = orphanIssue(sorted[i].correctedText, DEFAULT_WEAK_WORDS);
      const check = canMerge(sorted[i], sorted[i + 1], {
        measurer,
        maxWidthPx: profile.maxTextWidth,
        maxLines: profile.maxLines,
        maxMergeGapMs: profile.maxMergeGapMs,
        maxCharsPerSecond: profile.maxCharsPerSecond,
        customProtected,
        glossary,
      });
      if (check.ok || (orphan && stats.durationMs < 1500)) {
        out.push({ a: sorted[i].id, b: sorted[i + 1].id, reason: orphan ?? check.reason, ok: check.ok });
      }
    }
    return out.slice(0, 20);
  }, [sorted, formatted, measurer, profile, customProtected, glossary]);

  const doMerge = useCallback(
    (aId: number, bId: number) => {
      const a = s.cues.find((c) => c.id === aId);
      const b = s.cues.find((c) => c.id === bId);
      if (!a || !b) return;
      const merged = mergeCues(a, b);
      s.setCues(s.cues.filter((c) => c.id !== bId).map((c) => (c.id === aId ? merged : c)));
      setFormatted(false);
    },
    [s]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <section className="border border-zinc-800 rounded-xl p-4">
          <h2 className="font-bold mb-2">Profil de formatage</h2>
          <select
            value={s.activeProfileId}
            onChange={(e) => s.setActiveProfile(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm mb-2"
          >
            {s.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <button onClick={duplicateProfile} className="px-2 py-1 bg-zinc-800 rounded">Dupliquer</button>
            <button onClick={exportProfile} className="px-2 py-1 bg-zinc-800 rounded">Exporter</button>
            <label className="px-2 py-1 bg-zinc-800 rounded cursor-pointer">
              Importer
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importProfile(f);
                  e.target.value = "";
                }}
              />
            </label>
            {s.profiles.length > 1 && (
              <button onClick={() => s.removeProfile(profile.id)} className="px-2 py-1 bg-zinc-800 rounded hover:bg-red-900">
                Supprimer
              </button>
            )}
          </div>

          <div className="mt-3 space-y-2 text-sm">
            <label className="block">
              <span className="text-xs text-zinc-400">Nom du profil</span>
              <input
                value={profile.name}
                onChange={(e) => updateProfile({ name: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-1.5"
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-400">Police</span>
              <input
                value={profile.fontFamily}
                onChange={(e) => updateProfile({ fontFamily: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-1.5"
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-400">Alignement</span>
              <select
                value={profile.align}
                onChange={(e) => updateProfile({ align: e.target.value as FormatProfile["align"] })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-1.5"
              >
                <option value="center">Centré</option>
                <option value="left">Gauche</option>
                <option value="right">Droite</option>
              </select>
            </label>
            {NUMERIC_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="text-xs text-zinc-400">{f.label}</span>
                <input
                  type="number"
                  step={f.step ?? 1}
                  value={profile[f.key] as number}
                  onChange={(e) => updateProfile({ [f.key]: Number(e.target.value) } as Partial<FormatProfile>)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-1.5"
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            Calibrez ces valeurs sur votre projet Premiere (taille de police, largeur, marges) pour
            que la découpe corresponde exactement à votre rendu.
          </p>
        </section>

        <section className="border border-zinc-800 rounded-xl p-4">
          <h2 className="font-bold mb-2 text-sm">Expressions protégées personnalisées</h2>
          <textarea
            value={s.customProtectedText}
            onChange={(e) => s.setCustomProtectedText(e.target.value)}
            rows={3}
            placeholder={"une par ligne\nex. : L'Hydronaute"}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Jamais coupées entre deux lignes ni deux cues. Les heures, unités, %, noms composés,
            URL, e-mails… sont détectés automatiquement.
          </p>
        </section>
      </aside>

      <div className="space-y-4">
        <section className="border border-zinc-800 rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={runFormat}
              disabled={!ready || s.cues.length === 0}
              className="px-5 py-2 bg-green-500 text-zinc-950 rounded-lg font-bold disabled:opacity-40"
            >
              {ready ? "Calculer les lignes et découpes" : "Chargement de la police…"}
            </button>
            {fontFallback && (
              <span className="text-sm text-amber-400">
                ⚠️ Police « {profile.fontFamily} » indisponible : mesure avec Arial (repli explicite).
              </span>
            )}
          </div>
          {runWarnings.length > 0 && (
            <ul className="mt-2 text-sm text-amber-400 space-y-1">
              {runWarnings.map((w, i) => (
                <li key={i}>⚠️ {w}</li>
              ))}
            </ul>
          )}
        </section>

        {mergeSuggestions.length > 0 && (
          <section className="border border-zinc-800 rounded-xl p-4">
            <h2 className="font-bold mb-2 text-sm">Suggestions de fusion (jamais automatiques)</h2>
            <ul className="space-y-1 text-sm">
              {mergeSuggestions.map((m, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex-1">
                    Cues #{m.a} + #{m.b}
                    {m.reason ? ` — ${m.reason}` : ""}
                  </span>
                  <button
                    onClick={() => doMerge(m.a, m.b)}
                    className="px-2.5 py-1 bg-zinc-700 rounded text-xs font-semibold hover:bg-zinc-600"
                  >
                    Fusionner
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-1.5">
          {sorted.map((cue) => {
            const stats = readingStats(cue, ready ? measurer : null, profile.maxTextWidth);
            const tooFast = stats.charsPerSecond > profile.maxCharsPerSecond;
            return (
              <article key={cue.id} className="border border-zinc-800 rounded-lg p-2.5 text-sm flex gap-3">
                <div className="w-14 shrink-0 text-xs text-zinc-500 font-mono">#{cue.id}</div>
                <div className="flex-1 min-w-0">
                  {cue.formattedLines.length > 0 ? (
                    <div className="font-semibold">
                      {cue.formattedLines.map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-zinc-400 whitespace-pre-wrap">{cue.correctedText}</div>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs text-zinc-500 mt-1">
                    <span>{(stats.durationMs / 1000).toFixed(2)} s</span>
                    <span>{stats.charCount} car.</span>
                    <span>{stats.wordCount} mots</span>
                    <span className={tooFast ? "text-red-400 font-semibold" : ""}>
                      {stats.charsPerSecond.toFixed(1)} car./s
                    </span>
                    <span>{Math.round(stats.wordsPerMinute)} mots/min</span>
                    <span>{stats.lineCount} ligne{stats.lineCount > 1 ? "s" : ""}</span>
                    {ready && <span>{Math.round(stats.widthUsagePercent)} % de la largeur</span>}
                    {cue.isLocked && <span className="text-amber-400">🔒</span>}
                  </div>
                  {cue.warnings
                    .filter((w) => w.startsWith("[format]"))
                    .map((w, i) => (
                      <p key={i} className="text-xs text-amber-400 mt-0.5">⚠ {w.replace("[format] ", "")}</p>
                    ))}
                  {tooFast && (
                    <p className="text-xs text-red-400 mt-0.5">
                      ⚠ Vitesse de lecture élevée — envisagez une fusion, un découpage ou un ajustement du timing
                      (le texte n&apos;est jamais réécrit automatiquement).
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <div className="flex justify-end">
          <button
            onClick={() => s.setStep("verify")}
            className="px-5 py-2 bg-green-500 text-zinc-950 rounded-lg font-bold"
          >
            Continuer vers la vérification →
          </button>
        </div>
      </div>
    </div>
  );
}
