"use client";

import { useCallback, useRef, useState } from "react";
import { parseSrt } from "@/lib/srt/parse";
import { applyFrenchTypography } from "@/lib/text/typography";
import { transcribeMedia } from "@/lib/transcribe/client";
import { useFrankinator } from "@/lib/store";
import Frank from "../Frank";

/** Étape 1 — Importer : SRT (fichier, glisser-déposer, texte collé)
 *  ou vidéo/audio à transcrire (Whisper via le proxy). */
export default function ImportStep() {
  const s = useFrankinator();
  const [pasted, setPasted] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const importText = useCallback(
    (text: string, fileName: string | null) => {
      const { cues, issues } = parseSrt(text);
      s.loadCues(cues, issues, fileName);
    },
    [s]
  );

  const transcribe = useCallback(
    async (file: File) => {
      setTranscribeError(null);
      setTranscribing("Préparation…");
      try {
        const cues = await transcribeMedia(file, s.language, setTranscribing);
        s.loadCues(cues, [], file.name.replace(/\.[^.]+$/, "") + ".srt");
        // Garde la vidéo en mémoire : aperçu synchronisé + export incrusté.
        if (file.type.startsWith("video")) s.setMediaFile(file);
      } catch (e) {
        setTranscribeError((e as Error).message);
      } finally {
        setTranscribing(null);
      }
    },
    [s]
  );

  const readFile = useCallback(
    (file: File) => {
      // SRT -> parsing local ; vidéo/audio -> transcription Whisper.
      const isSrt = /\.srt$/i.test(file.name) || file.type.startsWith("text");
      if (!isSrt) {
        void transcribe(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => importText(String(reader.result ?? ""), file.name);
      reader.readAsText(file, "utf-8");
    },
    [importText, transcribe]
  );

  const errors = s.issues.filter((i) => i.severity === "error");
  const warnings = s.issues.filter((i) => i.severity === "warning");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) readFile(file);
          }}
          onClick={() => fileInput.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragOver ? "border-green-400 bg-green-500/10" : "border-zinc-700 hover:border-zinc-500"
          }`}
        >
          <p className="font-semibold">Glissez-déposez un fichier .srt — ou une vidéo/audio</p>
          <p className="text-sm text-zinc-400 mt-1">
            ou cliquez pour choisir un fichier. Une vidéo est transcrite automatiquement
            (l&apos;audio est extrait dans votre navigateur, la vidéo ne part jamais).
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".srt,text/plain,video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {transcribing && (
          <div className="flex items-center gap-3 border border-zinc-800 rounded-lg p-3">
            <Frank kind="pense" anim="think" size={44} title="Frank écoute…" />
            <p className="text-sm text-zinc-300">{transcribing}</p>
          </div>
        )}
        {transcribeError && (
          <p className="text-sm text-amber-400">⚠️ {transcribeError}</p>
        )}

        <div>
          <label className="block text-sm font-semibold mb-1">Ou collez le contenu SRT brut</label>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder={"1\n00:00:01,000 --> 00:00:03,000\nBonjour à tous…"}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm font-mono"
          />
          <button
            onClick={() => pasted.trim() && importText(pasted, null)}
            disabled={!pasted.trim()}
            className="mt-2 px-4 py-2 bg-green-500 text-zinc-950 rounded-lg font-semibold text-sm disabled:opacity-40"
          >
            Importer le texte collé
          </button>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1">Langue des sous-titres</label>
          <select
            value={s.language}
            onChange={(e) => s.setLanguage(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm"
          >
            <option value="fr">Français (par défaut)</option>
            <option value="en">Anglais</option>
            <option value="es">Espagnol</option>
            <option value="de">Allemand</option>
            <option value="it">Italien</option>
          </select>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <label className="block text-sm font-semibold mb-1">Contexte de la vidéo (optionnel)</label>
          <textarea
            value={s.videoContext}
            onChange={(e) => s.setVideoContext(e.target.value)}
            rows={2}
            placeholder="Ex. : interview d'un océanographe sur la pollution plastique…"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">
            Glossaire — noms propres et termes techniques (un par ligne)
          </label>
          <textarea
            value={s.glossaryText}
            onChange={(e) => s.setGlossaryText(e.target.value)}
            rows={3}
            placeholder={"Jean-Pierre Dupont\nAdobe Premiere Pro\nbiomimétisme"}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Transcript de référence (optionnel)</label>
          <textarea
            value={s.referenceTranscript}
            onChange={(e) => s.setReferenceTranscript(e.target.value)}
            rows={3}
            placeholder="Collez ici un transcript vérifié pour guider la correction…"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm"
          />
        </div>

        <div className="border border-zinc-800 rounded-lg p-3">
          <p className="text-sm font-semibold mb-2">Profils de correction réutilisables</p>
          <div className="flex gap-2">
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Nom du profil"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-sm"
            />
            <button
              onClick={() => {
                if (profileName.trim()) {
                  s.saveCorrectionProfile(profileName.trim());
                  setProfileName("");
                }
              }}
              className="px-3 py-2 bg-zinc-700 rounded-lg text-sm font-semibold hover:bg-zinc-600"
            >
              Sauvegarder
            </button>
          </div>
          {s.correctionProfiles.length > 0 && (
            <ul className="mt-2 space-y-1">
              {s.correctionProfiles.map((cp) => (
                <li key={cp.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{cp.name}</span>
                  <button
                    onClick={() => s.applyCorrectionProfile(cp.id)}
                    className="px-2 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
                  >
                    Appliquer
                  </button>
                  <button
                    onClick={() => s.deleteCorrectionProfile(cp.id)}
                    className="px-2 py-1 bg-zinc-800 rounded hover:bg-red-900"
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {(s.cues.length > 0 || s.issues.length > 0) && (
        <section className="lg:col-span-2 border border-zinc-800 rounded-xl p-4">
          <h2 className="font-bold mb-2">
            Rapport d&apos;import{s.fileName ? ` — ${s.fileName}` : ""}
          </h2>
          <p className="text-sm text-zinc-300">
            {s.cues.length} sous-titre{s.cues.length > 1 ? "s" : ""} importé{s.cues.length > 1 ? "s" : ""}.
            Aucun sous-titre n&apos;est écarté silencieusement : tout problème est listé ci-dessous.
          </p>
          {errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-red-400">
              {errors.map((i, idx) => (
                <li key={idx}>⛔ {i.cueId !== null ? `Cue ${i.cueId} : ` : ""}{i.message}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-amber-400">
              {warnings.map((i, idx) => (
                <li key={idx}>⚠️ {i.cueId !== null ? `Cue ${i.cueId} : ` : ""}{i.message}</li>
              ))}
            </ul>
          )}
          {s.cues.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => s.setStep("correct")}
                className="px-5 py-2 bg-green-500 text-zinc-950 rounded-lg font-bold"
              >
                Continuer vers la correction →
              </button>
              <button
                onClick={() => {
                  // Mode simple : typographie française déterministe (sans IA),
                  // puis saut direct à l'export — la découpe des lignes et des
                  // cues trop longs s'applique automatiquement à l'arrivée.
                  s.setCues(
                    s.cues.map((c) =>
                      c.isLocked ? c : { ...c, correctedText: applyFrenchTypography(c.correctedText) }
                    )
                  );
                  s.setStep("export");
                }}
                title="Typographie française + découpe automatique, zéro question, SRT direct."
                className="px-5 py-2 bg-zinc-700 rounded-lg font-semibold text-sm hover:bg-zinc-600"
              >
                🚀 Mode simple : « J&apos;ai pas envie de me prendre la tête, exporte-moi juste un
                SRT, je règle les détails dans Premiere/CapCut. Merci Frankinator »
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
