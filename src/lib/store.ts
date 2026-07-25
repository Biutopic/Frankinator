"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Cue, CorrectionOptions, FormatProfile, SrtIssue } from "./types";
import { DEFAULT_CORRECTION_OPTIONS, defaultProfiles } from "./types";

/**
 * État global de Frankinator, persisté en localStorage
 * (récupération de session après rafraîchissement ou fermeture).
 */

export type Step = "import" | "correct" | "format" | "verify" | "export";
export const STEPS: { id: Step; label: string }[] = [
  { id: "import", label: "Importer" },
  { id: "correct", label: "Corriger" },
  { id: "format", label: "Formater" },
  { id: "verify", label: "Vérifier" },
  { id: "export", label: "Exporter" },
];

/** Profil de correction réutilisable (glossaire + contexte + options). */
export interface CorrectionProfile {
  id: string;
  name: string;
  options: CorrectionOptions;
  glossary: string[];
  customProtected: string[];
}

interface HistoryEntry {
  cues: Cue[];
}

export interface FrankinatorState {
  step: Step;
  fileName: string | null;
  language: string;
  cues: Cue[];
  issues: SrtIssue[];
  videoContext: string;
  glossaryText: string;
  referenceTranscript: string;
  customProtectedText: string;
  options: CorrectionOptions;
  profiles: FormatProfile[];
  activeProfileId: string;
  correctionProfiles: CorrectionProfile[];
  fontReady: boolean;
  fontFallback: boolean;
  // Historique (annuler / rétablir) — non persisté.
  past: HistoryEntry[];
  future: HistoryEntry[];

  setStep: (step: Step) => void;
  loadCues: (cues: Cue[], issues: SrtIssue[], fileName: string | null) => void;
  setCues: (cues: Cue[], recordHistory?: boolean) => void;
  updateCue: (id: number, patch: Partial<Cue>, recordHistory?: boolean) => void;
  setLanguage: (l: string) => void;
  setVideoContext: (v: string) => void;
  setGlossaryText: (v: string) => void;
  setReferenceTranscript: (v: string) => void;
  setCustomProtectedText: (v: string) => void;
  setOptions: (patch: Partial<CorrectionOptions>) => void;
  setFontStatus: (ready: boolean, fallback: boolean) => void;
  setActiveProfile: (id: string) => void;
  upsertProfile: (profile: FormatProfile) => void;
  removeProfile: (id: string) => void;
  saveCorrectionProfile: (name: string) => void;
  applyCorrectionProfile: (id: string) => void;
  deleteCorrectionProfile: (id: string) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

export function glossaryList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const MAX_HISTORY = 50;

export const useFrankinator = create<FrankinatorState>()(
  persist(
    (set, get) => ({
      step: "import",
      fileName: null,
      language: "fr",
      cues: [],
      issues: [],
      videoContext: "",
      glossaryText: "",
      referenceTranscript: "",
      customProtectedText: "",
      options: { ...DEFAULT_CORRECTION_OPTIONS },
      profiles: defaultProfiles(),
      activeProfileId: "reel-instagram-premiere",
      correctionProfiles: [],
      fontReady: false,
      fontFallback: false,
      past: [],
      future: [],

      setStep: (step) => set({ step }),

      loadCues: (cues, issues, fileName) =>
        set({ cues, issues, fileName, past: [], future: [], step: "import" }),

      setCues: (cues, recordHistory = true) =>
        set((s) => ({
          cues,
          past: recordHistory ? [...s.past.slice(-MAX_HISTORY), { cues: s.cues }] : s.past,
          future: recordHistory ? [] : s.future,
        })),

      updateCue: (id, patch, recordHistory = true) => {
        const s = get();
        const cues = s.cues.map((c) => (c.id === id ? { ...c, ...patch } : c));
        set({
          cues,
          past: recordHistory ? [...s.past.slice(-MAX_HISTORY), { cues: s.cues }] : s.past,
          future: recordHistory ? [] : s.future,
        });
      },

      setLanguage: (language) => set({ language }),
      setVideoContext: (videoContext) => set({ videoContext }),
      setGlossaryText: (glossaryText) => set({ glossaryText }),
      setReferenceTranscript: (referenceTranscript) => set({ referenceTranscript }),
      setCustomProtectedText: (customProtectedText) => set({ customProtectedText }),
      setOptions: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),
      setFontStatus: (fontReady, fontFallback) => set({ fontReady, fontFallback }),

      setActiveProfile: (activeProfileId) => set({ activeProfileId }),
      upsertProfile: (profile) =>
        set((s) => {
          const exists = s.profiles.some((p) => p.id === profile.id);
          return {
            profiles: exists ? s.profiles.map((p) => (p.id === profile.id ? profile : p)) : [...s.profiles, profile],
          };
        }),
      removeProfile: (id) =>
        set((s) => ({
          profiles: s.profiles.filter((p) => p.id !== id),
          activeProfileId: s.activeProfileId === id ? "reel-instagram-premiere" : s.activeProfileId,
        })),

      saveCorrectionProfile: (name) =>
        set((s) => ({
          correctionProfiles: [
            ...s.correctionProfiles,
            {
              id: `cp-${Date.now()}`,
              name,
              options: { ...s.options },
              glossary: glossaryList(s.glossaryText),
              customProtected: glossaryList(s.customProtectedText),
            },
          ],
        })),
      applyCorrectionProfile: (id) => {
        const p = get().correctionProfiles.find((cp) => cp.id === id);
        if (!p) return;
        set({
          options: { ...p.options },
          glossaryText: p.glossary.join("\n"),
          customProtectedText: p.customProtected.join("\n"),
        });
      },
      deleteCorrectionProfile: (id) =>
        set((s) => ({ correctionProfiles: s.correctionProfiles.filter((cp) => cp.id !== id) })),

      undo: () => {
        const s = get();
        const prev = s.past[s.past.length - 1];
        if (!prev) return;
        set({
          cues: prev.cues,
          past: s.past.slice(0, -1),
          future: [{ cues: s.cues }, ...s.future].slice(0, MAX_HISTORY),
        });
      },
      redo: () => {
        const s = get();
        const next = s.future[0];
        if (!next) return;
        set({
          cues: next.cues,
          future: s.future.slice(1),
          past: [...s.past, { cues: s.cues }].slice(-MAX_HISTORY),
        });
      },

      reset: () =>
        set({
          step: "import",
          fileName: null,
          cues: [],
          issues: [],
          past: [],
          future: [],
        }),
    }),
    {
      name: "frankinator-session",
      // L'historique n'est pas persisté (volumineux et non essentiel).
      partialize: (s) => ({
        step: s.step,
        fileName: s.fileName,
        language: s.language,
        cues: s.cues,
        issues: s.issues,
        videoContext: s.videoContext,
        glossaryText: s.glossaryText,
        referenceTranscript: s.referenceTranscript,
        customProtectedText: s.customProtectedText,
        options: s.options,
        profiles: s.profiles,
        activeProfileId: s.activeProfileId,
        correctionProfiles: s.correctionProfiles,
      }),
    }
  )
);
