"use client";

import type { CorrectionRequest, CorrectionItem } from "./schema";
import { CORRECTION_JSON_SCHEMA, validateCorrectionResponse } from "./schema";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";

/**
 * Transport de correction côté client.
 *
 * 1. Mode serveur (par défaut) : POST /api/correct — la clé reste sur le serveur.
 * 2. Mode navigateur (build statique type GitHub Pages) : la clé fournie par
 *    l'utilisateur est stockée uniquement dans SON localStorage et envoyée
 *    directement à l'API Anthropic depuis son navigateur. Elle n'apparaît
 *    jamais dans le code ni sur un serveur tiers.
 */

export interface CorrectionResult {
  corrections: CorrectionItem[];
  missingIds: number[];
  problems: string[];
}

export const BROWSER_KEY_STORAGE = "frankinator.anthropicKey";

export function getBrowserKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(BROWSER_KEY_STORAGE);
}

export function setBrowserKey(key: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (key) localStorage.setItem(BROWSER_KEY_STORAGE, key);
  else localStorage.removeItem(BROWSER_KEY_STORAGE);
}

const IS_STATIC = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";
const MODEL = "claude-opus-4-8";

async function correctViaServer(req: CorrectionRequest): Promise<CorrectionResult> {
  const res = await fetch("/api/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `Erreur serveur (${res.status}).`;
    const error = new Error(message) as Error & { code?: string };
    error.code = (data as { error?: string } | null)?.error;
    throw error;
  }
  return data as CorrectionResult;
}

async function correctViaBrowser(req: CorrectionRequest, apiKey: string): Promise<CorrectionResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: CORRECTION_JSON_SCHEMA },
      },
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserPrompt(req) }],
    }),
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Clé API Anthropic invalide.");
    if (res.status === 429) throw new Error("Limite de débit atteinte. Réessayez dans quelques instants.");
    throw new Error(`Erreur API Claude (${res.status}).`);
  }
  const data = (await res.json()) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  };
  if (data.stop_reason === "refusal") throw new Error("Requête refusée par le modèle.");
  const text = data.content?.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Réponse vide du modèle.");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("JSON invalide renvoyé par le modèle.");
  }
  const originalById = new Map(req.cues.map((c) => [c.id, c.text]));
  const v = validateCorrectionResponse(raw, req.cues.map((c) => c.id), originalById);
  return { corrections: v.valid, missingIds: v.missingIds, problems: v.problems };
}

/** Corrige un lot de cues via le transport disponible. */
export async function correctBatch(req: CorrectionRequest): Promise<CorrectionResult> {
  const browserKey = getBrowserKey();
  if (IS_STATIC) {
    if (!browserKey)
      throw Object.assign(
        new Error("Version statique : ajoutez votre clé API Anthropic (stockée uniquement dans votre navigateur)."),
        { code: "missing_api_key" }
      );
    return correctViaBrowser(req, browserKey);
  }
  try {
    return await correctViaServer(req);
  } catch (error) {
    // Serveur sans clé configurée : repli sur la clé navigateur si présente.
    if ((error as { code?: string }).code === "missing_api_key" && browserKey) {
      return correctViaBrowser(req, browserKey);
    }
    throw error;
  }
}
