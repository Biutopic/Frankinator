import { z } from "zod";

/**
 * Contrat d'échange avec Claude, validé par Zod des deux côtés.
 * IMPORTANT : aucun timecode ne transite — la correction linguistique
 * ne peut par construction pas modifier le timing.
 */

export const CorrectionRequestSchema = z.object({
  cues: z
    .array(
      z.object({
        id: z.number().int(),
        text: z.string(),
      })
    )
    .min(1)
    .max(40),
  /** Contexte : quelques cues avant/après le lot, pour la cohérence. */
  contextBefore: z.string().default(""),
  contextAfter: z.string().default(""),
  videoContext: z.string().default(""),
  glossary: z.array(z.string()).default([]),
  referenceTranscript: z.string().default(""),
  language: z.string().default("fr"),
  options: z.record(z.string(), z.union([z.boolean(), z.string()])).default({}),
});

export type CorrectionRequest = z.infer<typeof CorrectionRequestSchema>;

export const CorrectionItemSchema = z.object({
  id: z.number().int(),
  correctedText: z.string(),
  confidence: z.enum(["high", "low"]),
  warning: z.string().nullable(),
});

export const CorrectionResponseSchema = z.object({
  corrections: z.array(CorrectionItemSchema),
});

export type CorrectionItem = z.infer<typeof CorrectionItemSchema>;
export type CorrectionResponse = z.infer<typeof CorrectionResponseSchema>;

/** JSON Schema strict pour output_config.format (sorties structurées). */
export const CORRECTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          correctedText: { type: "string" },
          confidence: { type: "string", enum: ["high", "low"] },
          warning: { type: ["string", "null"] },
        },
        required: ["id", "correctedText", "confidence", "warning"],
        additionalProperties: false,
      },
    },
  },
  required: ["corrections"],
  additionalProperties: false,
} as const;

export interface ValidatedCorrections {
  /** Corrections acceptées (id connu, texte non vide). */
  valid: CorrectionItem[];
  /** Ids demandés absents de la réponse (réponse partielle). */
  missingIds: number[];
  /** Problèmes détectés (ids inconnus, textes vides, texte suspect…). */
  problems: string[];
}

/**
 * Validation de sécurité d'une réponse de Claude.
 * Une réponse invalide n'écrase jamais le travail local :
 * seuls les items valides sont retournés, le reste est signalé.
 */
export function validateCorrectionResponse(
  raw: unknown,
  requestedIds: number[],
  originalById: Map<number, string>
): ValidatedCorrections {
  const problems: string[] = [];
  const parsed = CorrectionResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: [],
      missingIds: [...requestedIds],
      problems: [`Réponse IA invalide : ${parsed.error.issues[0]?.message ?? "format inattendu"}`],
    };
  }

  const requested = new Set(requestedIds);
  const seen = new Set<number>();
  const valid: CorrectionItem[] = [];

  for (const item of parsed.data.corrections) {
    if (!requested.has(item.id)) {
      problems.push(`Cue inconnu ${item.id} renvoyé par l'IA (ignoré).`);
      continue;
    }
    if (seen.has(item.id)) {
      problems.push(`Cue ${item.id} renvoyé en double (doublon ignoré).`);
      continue;
    }
    seen.add(item.id);

    const original = originalById.get(item.id) ?? "";
    const text = item.correctedText;

    if (text.trim() === "" && original.trim() !== "") {
      problems.push(`Cue ${item.id} : texte corrigé vide (original conservé).`);
      valid.push({ ...item, correctedText: original, confidence: "low", warning: "L'IA a renvoyé un texte vide." });
      continue;
    }
    // Garde-fou anti-expansion : un texte corrigé beaucoup plus long que
    // l'original suggère un ajout d'information ou une explication parasite.
    if (original.length > 0 && text.length > original.length * 1.8 + 30) {
      valid.push({
        ...item,
        correctedText: original,
        confidence: "low",
        warning: "Correction suspecte (texte fortement rallongé) : original conservé, à vérifier.",
      });
      continue;
    }
    valid.push(item);
  }

  const missingIds = requestedIds.filter((id) => !seen.has(id));
  if (missingIds.length > 0)
    problems.push(`Réponse partielle : cues ${missingIds.join(", ")} non corrigés (originaux conservés).`);

  return { valid, missingIds, problems };
}
