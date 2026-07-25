"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormatProfile } from "@/lib/types";
import {
  createCanvasMeasurer,
  createFakeMeasurer,
  ensureFontLoaded,
  type TextMeasurer,
} from "@/lib/format/measure";
import { useFrankinator } from "@/lib/store";

/**
 * Fournit le mesureur de texte pour le profil actif.
 * Attend le chargement effectif de la police avant de mesurer ;
 * signale le repli (fallback) si la police est indisponible.
 */
export function useMeasurer(profile: FormatProfile): { measurer: TextMeasurer; fontFallback: boolean; ready: boolean } {
  const [state, setState] = useState<{ measurer: TextMeasurer; fallback: boolean; ready: boolean } | null>(null);
  const setFontStatus = useFrankinator((s) => s.setFontStatus);

  const spec = useMemo(
    () => ({
      fontFamily: profile.fontFamily,
      fontWeight: profile.fontWeight,
      fontSizePx: profile.fontSizePx,
      trackingEm: profile.trackingEm,
    }),
    [profile.fontFamily, profile.fontWeight, profile.fontSizePx, profile.trackingEm]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await ensureFontLoaded(spec);
      if (cancelled) return;
      const measurer = createCanvasMeasurer(spec, loaded);
      setState({ measurer, fallback: !loaded, ready: true });
      setFontStatus(true, !loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [spec, setFontStatus]);

  // Mesureur déterministe en attendant la police (mêmes ordres de grandeur).
  const fallbackMeasurer = useMemo(() => createFakeMeasurer(spec), [spec]);

  return {
    measurer: state?.measurer ?? fallbackMeasurer,
    fontFallback: state?.fallback ?? false,
    ready: state?.ready ?? false,
  };
}
