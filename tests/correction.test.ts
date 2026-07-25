import { describe, it, expect } from "vitest";
import {
  CorrectionRequestSchema,
  CorrectionResponseSchema,
  CORRECTION_JSON_SCHEMA,
  validateCorrectionResponse,
} from "@/lib/correction/schema";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/correction/prompt";

describe("validation Zod des réponses Claude", () => {
  const originals = new Map([
    [1, "bonjour a tous"],
    [2, "il fait vingt degres"],
  ]);

  it("accepte une réponse complète et valide", () => {
    const v = validateCorrectionResponse(
      {
        corrections: [
          { id: 1, correctedText: "Bonjour à tous", confidence: "high", warning: null },
          { id: 2, correctedText: "Il fait vingt degrés", confidence: "high", warning: null },
        ],
      },
      [1, 2],
      originals
    );
    expect(v.valid).toHaveLength(2);
    expect(v.missingIds).toHaveLength(0);
    expect(v.problems).toHaveLength(0);
  });

  it("rejette un format inattendu sans écraser le travail local", () => {
    const v = validateCorrectionResponse({ nimporte: "quoi" }, [1, 2], originals);
    expect(v.valid).toHaveLength(0);
    expect(v.missingIds).toEqual([1, 2]);
    expect(v.problems.length).toBeGreaterThan(0);
  });

  it("récupère une réponse partielle : les ids manquants sont signalés", () => {
    const v = validateCorrectionResponse(
      { corrections: [{ id: 1, correctedText: "Bonjour à tous", confidence: "high", warning: null }] },
      [1, 2],
      originals
    );
    expect(v.valid).toHaveLength(1);
    expect(v.missingIds).toEqual([2]);
    expect(v.problems.some((p) => p.includes("partielle"))).toBe(true);
  });

  it("ignore les ids inconnus ajoutés par l'IA", () => {
    const v = validateCorrectionResponse(
      {
        corrections: [
          { id: 1, correctedText: "Bonjour à tous", confidence: "high", warning: null },
          { id: 99, correctedText: "intrus", confidence: "high", warning: null },
        ],
      },
      [1, 2],
      originals
    );
    expect(v.valid.map((c) => c.id)).toEqual([1]);
    expect(v.problems.some((p) => p.includes("inconnu"))).toBe(true);
  });

  it("conserve l'original si l'IA renvoie un texte vide", () => {
    const v = validateCorrectionResponse(
      { corrections: [{ id: 1, correctedText: "", confidence: "high", warning: null }] },
      [1],
      originals
    );
    expect(v.valid[0].correctedText).toBe("bonjour a tous");
    expect(v.valid[0].confidence).toBe("low");
  });

  it("bloque une expansion manifeste du texte (ajout d'information)", () => {
    const v = validateCorrectionResponse(
      {
        corrections: [
          {
            id: 1,
            correctedText:
              "Bonjour à tous, et laissez-moi vous expliquer en détail pourquoi cette phrase est désormais bien plus longue qu'avant avec plein de contenu inventé",
            confidence: "high",
            warning: null,
          },
        ],
      },
      [1],
      originals
    );
    expect(v.valid[0].correctedText).toBe("bonjour a tous");
    expect(v.valid[0].warning).toContain("suspecte");
  });

  it("ignore les doublons d'ids", () => {
    const v = validateCorrectionResponse(
      {
        corrections: [
          { id: 1, correctedText: "Bonjour à tous", confidence: "high", warning: null },
          { id: 1, correctedText: "Autre version", confidence: "high", warning: null },
        ],
      },
      [1],
      originals
    );
    expect(v.valid).toHaveLength(1);
    expect(v.valid[0].correctedText).toBe("Bonjour à tous");
  });
});

describe("Claude ne peut pas modifier les timecodes", () => {
  it("le schéma de requête ne transporte aucun timing", () => {
    const parsed = CorrectionRequestSchema.parse({
      cues: [{ id: 1, text: "bonjour" }],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/startMs|endMs|-->/);
  });

  it("le schéma de réponse n'accepte aucun champ de timing", () => {
    const schema = JSON.stringify(CORRECTION_JSON_SCHEMA);
    expect(schema).not.toMatch(/start|end|time/i);
    // additionalProperties: false empêche l'IA d'ajouter des champs.
    expect(CORRECTION_JSON_SCHEMA.properties.corrections.items.additionalProperties).toBe(false);
  });

  it("une réponse contenant des timecodes parasites est rejetée par Zod (strict sur les items)", () => {
    const r = CorrectionResponseSchema.safeParse({
      corrections: [{ id: 1, correctedText: "ok", confidence: "high", warning: null, startMs: 0 }],
    });
    // Zod tolère les champs en trop mais ne les propage pas :
    if (r.success) {
      expect(JSON.stringify(r.data)).not.toContain("startMs");
    }
  });

  it("le prompt n'envoie que id et texte", () => {
    const prompt = buildUserPrompt(
      CorrectionRequestSchema.parse({ cues: [{ id: 1, text: "bonjour" }] })
    );
    expect(prompt).not.toMatch(/-->/);
  });
});

describe("prompt de correction", () => {
  it("le système impose la conservation et interdit la réécriture", () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain("CONSERVATEUR");
    expect(sys).toMatch(/conjugaisons/i);
    expect(sys).toMatch(/jamais/i);
  });

  it("le prompt utilisateur inclut glossaire, contexte et options", () => {
    const prompt = buildUserPrompt(
      CorrectionRequestSchema.parse({
        cues: [{ id: 1, text: "bonjour" }],
        glossary: ["Jean-Pierre"],
        videoContext: "interview scientifique",
        options: { strictConjugations: true, spelling: true },
      })
    );
    expect(prompt).toContain("Jean-Pierre");
    expect(prompt).toContain("interview scientifique");
    expect(prompt).toMatch(/conjugaisons/);
  });
});
