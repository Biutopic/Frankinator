/**
 * Proxy de correction Frankinator (Cloudflare Worker).
 *
 * - La clé Anthropic reste côté serveur (secret Cloudflare) : les visiteurs
 *   du site statique GitHub Pages profitent de la correction IA sans clé.
 * - CORS verrouillé sur les origines autorisées.
 * - Double limite de débit : par IP (anti-abus) et globale (plafond de coût).
 * - Mêmes prompts et même validation Zod que l'application.
 */

import {
  CorrectionRequestSchema,
  CORRECTION_JSON_SCHEMA,
  validateCorrectionResponse,
} from "../../src/lib/correction/schema";
import { buildSystemPrompt, buildUserPrompt } from "../../src/lib/correction/prompt";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface WorkersAI {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  ALLOWED_ORIGINS: string;
  PER_IP_LIMIT: RateLimiter;
  GLOBAL_LIMIT: RateLimiter;
  TRANSCRIBE_IP_LIMIT: RateLimiter;
  TRANSCRIBE_GLOBAL_LIMIT: RateLimiter;
  AI: WorkersAI;
}

const MAX_BODY_BYTES = 200_000;

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  const ok = origin !== null && allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

/**
 * POST /transcribe — transcription Whisper (Workers AI).
 * Corps : la chaîne base64 de l'audio WAV (texte brut, pas de JSON, pour
 * rester dans le budget CPU du plan gratuit). Langue via ?lang=fr.
 * Réponse : { cues: [{ startMs, endMs, text }], text }.
 */
const MAX_AUDIO_B64_BYTES = 16_000_000; // ~4 min de WAV mono 16 kHz par morceau

async function handleTranscribe(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "inconnu";
  const pass = { success: true };
  const [perIp, global] = await Promise.all([
    env.TRANSCRIBE_IP_LIMIT ? env.TRANSCRIBE_IP_LIMIT.limit({ key: ip }) : pass,
    env.TRANSCRIBE_GLOBAL_LIMIT ? env.TRANSCRIBE_GLOBAL_LIMIT.limit({ key: "global" }) : pass,
  ]);
  if (!perIp.success || !global.success)
    return json(
      { error: "rate_limited", message: "Trop de transcriptions en cours : réessayez dans une minute." },
      429,
      cors
    );

  const lang = new URL(request.url).searchParams.get("lang") || "fr";
  const audioB64 = (await request.text()).trim();
  if (audioB64.length === 0)
    return json({ error: "empty", message: "Aucun audio reçu." }, 400, cors);
  if (audioB64.length > MAX_AUDIO_B64_BYTES)
    return json(
      { error: "too_large", message: "Morceau audio trop volumineux (max ~4 minutes par envoi)." },
      413,
      cors
    );

  let result: {
    text?: string;
    segments?: {
      start?: number;
      end?: number;
      text?: string;
      words?: { word?: string; start?: number; end?: number }[];
    }[];
  };
  try {
    result = (await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioB64,
      task: "transcribe",
      language: lang,
      vad_filter: true,
    })) as typeof result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(
      { error: "ai_error", message: `Transcription impossible (${msg.slice(0, 120)}).` },
      502,
      cors
    );
  }

  const cues = (result.segments ?? [])
    .filter((s) => typeof s.start === "number" && typeof s.end === "number" && (s.text ?? "").trim() !== "")
    .map((s) => ({
      startMs: Math.round((s.start as number) * 1000),
      endMs: Math.round((s.end as number) * 1000),
      text: (s.text as string).trim(),
      // Timestamps mot à mot : indispensables pour des cues courts façon Reel.
      words: (s.words ?? [])
        .filter((w) => typeof w.start === "number" && typeof w.end === "number" && (w.word ?? "").trim() !== "")
        .map((w) => ({
          text: (w.word as string).trim(),
          startMs: Math.round((w.start as number) * 1000),
          endMs: Math.round((w.end as number) * 1000),
        })),
    }));

  return json({ cues, text: result.text ?? "" }, 200, cors);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST")
      return json({ error: "method", message: "POST uniquement." }, 405, cors);

    // Origine inconnue : refus (le proxy sert uniquement Frankinator).
    const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
    if (!origin || !allowed.includes(origin))
      return json({ error: "origin", message: "Origine non autorisée." }, 403, cors);

    if (new URL(request.url).pathname === "/transcribe") {
      return handleTranscribe(request, env, cors);
    }

    if (!env.ANTHROPIC_API_KEY)
      return json(
        { error: "missing_api_key", message: "Clé API non configurée sur le proxy." },
        503,
        cors
      );

    // Limites de débit : IP puis globale (absentes en dev local -> pas de limite).
    const ip = request.headers.get("CF-Connecting-IP") ?? "inconnu";
    const pass = { success: true };
    const [perIp, global] = await Promise.all([
      env.PER_IP_LIMIT ? env.PER_IP_LIMIT.limit({ key: ip }) : pass,
      env.GLOBAL_LIMIT ? env.GLOBAL_LIMIT.limit({ key: "global" }) : pass,
    ]);
    if (!perIp.success)
      return json(
        { error: "rate_limited", message: "Trop de requêtes : attendez une minute avant de relancer la correction." },
        429,
        cors
      );
    if (!global.success)
      return json(
        { error: "rate_limited", message: "Le service de correction est très demandé : réessayez dans une minute." },
        429,
        cors
      );

    // Corps de requête : taille bornée puis validation Zod stricte.
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES)
      return json({ error: "too_large", message: "Requête trop volumineuse." }, 413, cors);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json", message: "Corps de requête invalide." }, 400, cors);
    }
    const parsed = CorrectionRequestSchema.safeParse(body);
    if (!parsed.success)
      return json(
        { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Requête invalide." },
        400,
        cors
      );
    const req = parsed.data;

    // Appel Anthropic (fetch direct : pas de SDK nécessaire dans le Worker).
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || "claude-opus-4-8",
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

    if (!anthropicRes.ok) {
      if (anthropicRes.status === 429)
        return json(
          { error: "rate_limited", message: "Limite de débit Anthropic atteinte. Réessayez dans quelques instants." },
          429,
          cors
        );
      return json(
        { error: "api_error", message: `Erreur API Claude (${anthropicRes.status}). Les originaux sont conservés.` },
        502,
        cors
      );
    }

    const data = (await anthropicRes.json()) as {
      stop_reason?: string;
      model?: string;
      content?: { type: string; text?: string }[];
    };
    if (data.stop_reason === "refusal")
      return json(
        { error: "refusal", message: "La requête a été refusée par le modèle. Les originaux sont conservés." },
        502,
        cors
      );
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text)
      return json(
        { error: "empty_response", message: "Réponse vide du modèle. Les originaux sont conservés." },
        502,
        cors
      );

    let rawModel: unknown;
    try {
      rawModel = JSON.parse(text);
    } catch {
      return json(
        { error: "invalid_model_json", message: "JSON invalide renvoyé par le modèle. Les originaux sont conservés." },
        502,
        cors
      );
    }

    const originalById = new Map(req.cues.map((c) => [c.id, c.text]));
    const validated = validateCorrectionResponse(rawModel, req.cues.map((c) => c.id), originalById);

    return json(
      {
        corrections: validated.valid,
        missingIds: validated.missingIds,
        problems: validated.problems,
        model: data.model,
      },
      200,
      cors
    );
  },
};

export default worker;
