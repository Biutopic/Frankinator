import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  CorrectionRequestSchema,
  CORRECTION_JSON_SCHEMA,
  validateCorrectionResponse,
} from "@/lib/correction/schema";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/correction/prompt";

/**
 * Route serveur de correction linguistique.
 * La clé API reste côté serveur (ANTHROPIC_API_KEY) et n'est jamais
 * exposée au client. Aucun timecode ne transite par cette route.
 */

export const runtime = "nodejs";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error: "missing_api_key",
        message:
          "ANTHROPIC_API_KEY n'est pas configurée côté serveur. Ajoutez-la dans .env.local, ou utilisez le mode navigateur.",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Corps de requête invalide." }, { status: 400 });
  }

  const parsed = CorrectionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Requête invalide." },
      { status: 400 }
    );
  }
  const req = parsed.data;

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: CORRECTION_JSON_SCHEMA },
      },
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserPrompt(req) }],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "refusal", message: "La requête a été refusée par le modèle. Les originaux sont conservés." },
        { status: 502 }
      );
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "empty_response", message: "Réponse vide du modèle. Les originaux sont conservés." },
        { status: 502 }
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(textBlock.text);
    } catch {
      return NextResponse.json(
        { error: "invalid_model_json", message: "JSON invalide renvoyé par le modèle. Les originaux sont conservés." },
        { status: 502 }
      );
    }

    const originalById = new Map(req.cues.map((c) => [c.id, c.text]));
    const validated = validateCorrectionResponse(raw, req.cues.map((c) => c.id), originalById);

    return NextResponse.json({
      corrections: validated.valid,
      missingIds: validated.missingIds,
      problems: validated.problems,
      model: response.model,
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "rate_limited", message: "Limite de débit atteinte. Réessayez dans quelques instants." },
        { status: 429 }
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "auth", message: "Clé API invalide côté serveur." },
        { status: 503 }
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: "api_error", message: `Erreur API Claude (${error.status ?? "?"}). Les originaux sont conservés.` },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "network", message: "Erreur réseau vers l'API Claude. Les originaux sont conservés." },
      { status: 502 }
    );
  }
}
