"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrankinator, glossaryList } from "@/lib/store";
import { buildExports, downloadFile, validateForExport } from "@/lib/export";
import { useMeasurer } from "../useMeasurer";
import Frank, { FRANK_ASSETS } from "../Frank";

/**
 * Le dernier grain de sel : la vidéo de Frank est jouée juste avant
 * d'afficher le résultat, à chaque arrivée sur l'étape Exporter.
 */
function GrainDeSel({ onDone }: { onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Tente la lecture avec son ; en cas de blocage navigateur, repli muet.
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => onDone());
    });
  }, [onDone]);

  return (
    <div className="frank-overlay fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-4 p-6">
      <p className="text-lg font-bold text-zinc-100">
        Frank ajoute le dernier grain de sel…
      </p>
      <video
        ref={videoRef}
        src={FRANK_ASSETS.video}
        onEnded={onDone}
        playsInline
        className="max-h-[70vh] max-w-full rounded-xl border border-zinc-700"
      />
      <button
        onClick={onDone}
        className="px-4 py-2 bg-zinc-800 rounded-lg text-sm font-semibold hover:bg-zinc-700"
      >
        Passer →
      </button>
    </div>
  );
}

/** Étape 5 — Exporter : validation finale + fichiers FRANKINATED. */
export default function ExportStep() {
  const s = useFrankinator();
  const profile = s.profiles.find((p) => p.id === s.activeProfileId) ?? s.profiles[0];
  const { measurer, ready } = useMeasurer(profile);
  const [copied, setCopied] = useState(false);
  const [grainDeSel, setGrainDeSel] = useState(true);

  const checklist = useMemo(
    () =>
      validateForExport(
        s.cues,
        profile,
        ready ? measurer : null,
        glossaryList(s.customProtectedText),
        glossaryList(s.glossaryText)
      ),
    [s.cues, profile, measurer, ready, s.customProtectedText, s.glossaryText]
  );

  const allOk = checklist.every((c) => c.ok);
  const exports = useMemo(() => buildExports(s.cues, s.fileName), [s.cues, s.fileName]);

  const copySrt = async () => {
    await navigator.clipboard.writeText(exports.formatted.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadAll = () => {
    downloadFile(exports.clean.name, exports.clean.content);
    downloadFile(exports.formatted.name, exports.formatted.content);
    downloadFile(exports.transcript.name, exports.transcript.content);
    downloadFile(exports.report.name, exports.report.content, "application/json");
  };

  if (s.cues.length === 0) return <p className="text-zinc-400">Importez d&apos;abord un fichier SRT.</p>;

  if (grainDeSel) {
    return <GrainDeSel onDone={() => setGrainDeSel(false)} />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="border border-zinc-800 rounded-xl p-4">
        <h2 className="font-bold mb-3">Validation avant export</h2>
        <ul className="space-y-1.5 text-sm">
          {checklist.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span>{item.ok ? "✅" : "❌"}</span>
              <span>
                {item.label}
                {item.detail && <span className="block text-xs text-zinc-500">{item.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
        {!allOk && (
          <p className="mt-3 text-sm text-amber-400">
            ⚠️ Corrigez les points en erreur (étapes Formater / Vérifier) avant d&apos;exporter pour
            Premiere Pro. L&apos;export reste possible mais le fichier peut être rejeté ou mal affiché.
          </p>
        )}
        {allOk && (
          <p className="mt-3 text-sm text-green-400">
            ✅ Le fichier est prêt pour Adobe Premiere Pro (UTF-8 + BOM, virgules SRT, index séquentiels).
          </p>
        )}
        <div className="mt-4 flex items-center gap-3 border-t border-zinc-800 pt-3">
          <Frank kind={allOk ? "sourire" : "pense"} anim="pop" size={56} title="Le vrai Frank" />
          <p className="text-sm text-amber-300 italic">
            Résultat à faire valider de toute façon par le vrai Frank.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="border border-zinc-800 rounded-xl p-4 space-y-2">
          <h2 className="font-bold">Exports</h2>
          {(
            [
              ["SRT corrigé (structure d'origine)", exports.clean],
              ["SRT corrigé et formaté", exports.formatted],
              ["Transcript texte brut", exports.transcript],
              ["Rapport de correction (JSON)", exports.report],
            ] as const
          ).map(([label, file]) => (
            <div key={file.name} className="flex items-center gap-2 text-sm">
              <span className="flex-1">
                {label}
                <span className="block text-xs text-zinc-500 font-mono">{file.name}</span>
              </span>
              <button
                onClick={() => downloadFile(file.name, file.content, file.name.endsWith(".json") ? "application/json" : "text/plain")}
                className="px-3 py-1.5 bg-zinc-700 rounded-lg font-semibold hover:bg-zinc-600"
              >
                Télécharger
              </button>
            </div>
          ))}

          <div className="flex flex-wrap gap-2 pt-2">
            <button onClick={copySrt} className="px-4 py-2 bg-zinc-700 rounded-lg font-semibold hover:bg-zinc-600 text-sm">
              {copied ? "✓ Copié !" : "Copier le SRT"}
            </button>
            <button onClick={downloadAll} className="px-4 py-2 bg-green-500 text-zinc-950 rounded-lg font-bold text-sm">
              Télécharger tous les exports
            </button>
          </div>
        </div>

        <div className="border border-zinc-800 rounded-xl p-4 flex flex-wrap gap-2">
          <button
            onClick={() => {
              // La session est déjà persistée en continu ; ce bouton force
              // une confirmation visuelle pour l'utilisateur.
              alert("Projet sauvegardé localement (localStorage de ce navigateur).");
            }}
            className="px-4 py-2 bg-zinc-700 rounded-lg font-semibold text-sm hover:bg-zinc-600"
          >
            Sauvegarder le projet localement
          </button>
          <button
            onClick={() => {
              if (confirm("Réinitialiser le projet ? Les sous-titres importés et corrections seront effacés.")) {
                s.reset();
              }
            }}
            className="px-4 py-2 bg-red-900 rounded-lg font-semibold text-sm hover:bg-red-800"
          >
            Réinitialiser
          </button>
        </div>

        <details className="border border-zinc-800 rounded-xl p-4 text-sm">
          <summary className="font-bold cursor-pointer">Aperçu du SRT formaté</summary>
          <pre className="mt-2 text-xs font-mono whitespace-pre-wrap max-h-72 overflow-y-auto text-zinc-300">
            {exports.formatted.content.slice(0, 4000)}
            {exports.formatted.content.length > 4000 ? "\n…" : ""}
          </pre>
        </details>
      </section>
    </div>
  );
}
