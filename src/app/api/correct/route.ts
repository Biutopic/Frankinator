import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import {
  CorrectionRequestSchema,
  CORRECTION_JSON_SCHEMA,
  validateCorrectionResponse,
  type CorrectionRequest,
} from "@/lib/correction/schema";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/correction/prompt";

/**
 * Route serveur de correction linguistique. Deux moteurs :
 * 1. ANTHROPIC_API_KEY définie -> API Anthropic (production/serveur).
 * 2. Sinon, en local -> Claude Code CLI (`claude -p`) sous la session
 *    connectée de l'utilisateur : couvert par son abonnement, la clé
 *    n'existe nulle part. Même pattern que Mission Control.
 * Aucun timecode ne transite par cette route.
 */

export const runtime = "nodejs";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

/** Correction via Claude Code CLI local (abonnement de l'utilisateur). */
async function correctViaClaudeCode(req: CorrectionRequest): Promise<NextResponse> {
  const prompt = `${buildSystemPrompt()}

${buildUserPrompt(req)}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni bloc de code, au format exact :
{"corrections":[{"id":<int>,"correctedText":"<string>","confidence":"high"|"low","warning":<string|null>}]}`;

  // Environnement nettoyé : si ce serveur a été lancé depuis une session
  // Claude Code, les variables héritées feraient échouer la CLI imbriquée.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^CLAUDE/i.test(k)) env[k] = v;
  }

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "json"], {
      shell: true,
      windowsHide: true,
      env,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Délai dépassé (Claude Code local)."));
    }, 180_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else
        reject(
          new Error(
            (err.trim() || out.trim()).slice(0, 200) || `claude -p a échoué (code ${code}).`
          )
        );
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });

  // Enveloppe --output-format json : { result: "<texte du modèle>", ... }
  const envelope = JSON.parse(stdout) as { result?: string; is_error?: boolean };
  if (envelope.is_error || typeof envelope.result !== "string")
    throw new Error("Réponse invalide de Claude Code.");
  const cleaned = envelope.result.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const raw = JSON.parse(cleaned);

  const originalById = new Map(req.cues.map((c) => [c.id, c.text]));
  const validated = validateCorrectionResponse(raw, req.cues.map((c) => c.id), originalById);
  return NextResponse.json({
    corrections: validated.valid,
    missingIds: validated.missingIds,
    problems: validated.problems,
    model: "claude-code-local",
  });
}

export async function POST(request: Request) {

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

  // Sans clé API : moteur local Claude Code (abonnement de l'utilisateur).
  if (!process.env.ANTHROPIC_API_KEY) {
    try {
      return await correctViaClaudeCode(req);
    } catch (e) {
      return NextResponse.json(
        {
          error: "missing_api_key",
          message: `Ni ANTHROPIC_API_KEY ni Claude Code local disponibles (${(e as Error).message.slice(0, 120)}). Ajoutez une clé dans .env.local, ou utilisez le mode navigateur.`,
        },
        { status: 503 }
      );
    }
  }

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
