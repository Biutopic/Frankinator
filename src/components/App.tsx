"use client";

import { useFrankinator, STEPS } from "@/lib/store";
import Frank from "./Frank";
import ImportStep from "./steps/ImportStep";
import CorrectStep from "./steps/CorrectStep";
import FormatStep from "./steps/FormatStep";
import VerifyStep from "./steps/VerifyStep";
import ExportStep from "./steps/ExportStep";

export default function App() {
  const step = useFrankinator((s) => s.step);
  const setStep = useFrankinator((s) => s.setStep);
  const cues = useFrankinator((s) => s.cues);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <header className="mb-6 flex items-center gap-4">
        <Frank kind="face" anim="bob" size={64} title="Frank" />
        <div>
          <h1 className="text-3xl font-black tracking-tight">
            <span className="text-green-400">Frank</span>inator
          </h1>
          <p className="text-zinc-400 text-sm mt-1 italic">
            Tes sous-titres passent à la moulinette de Frank.
          </p>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 mb-6" aria-label="Étapes">
        {STEPS.map((s, i) => {
          const enabled = i === 0 || cues.length > 0;
          return (
            <button
              key={s.id}
              onClick={() => enabled && setStep(s.id)}
              disabled={!enabled}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                s.id === step
                  ? "bg-green-500 text-zinc-950"
                  : enabled
                    ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    : "bg-zinc-900 text-zinc-600 cursor-not-allowed"
              }`}
            >
              {i + 1}. {s.label}
            </button>
          );
        })}
      </nav>

      <main>
        {step === "import" && <ImportStep />}
        {step === "correct" && <CorrectStep />}
        {step === "format" && <FormatStep />}
        {step === "verify" && <VerifyStep />}
        {step === "export" && <ExportStep />}
      </main>

      <footer className="mt-10 text-xs text-zinc-500 border-t border-zinc-800 pt-4 space-y-1">
        <p>
          Confidentialité : l&apos;analyse SRT, le formatage et l&apos;aperçu se font entièrement dans votre
          navigateur. Seul le texte des sous-titres à corriger est envoyé à Claude (jamais vos médias).
          Aucun fichier n&apos;est stocké de façon permanente. La clé API reste côté serveur (ou dans votre
          navigateur en mode statique). Le formatage fonctionne sans correction IA.
        </p>
        <p>
          Étape {stepIndex + 1}/5 — session sauvegardée automatiquement en local.
        </p>
      </footer>
    </div>
  );
}
