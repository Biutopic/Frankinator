import { describe, it, expect } from "vitest";
import { breakIntoLines, scoreBreak } from "@/lib/format/linebreak";
import { createFakeMeasurer } from "@/lib/format/measure";
import { APOSTROPHES } from "@/lib/text/tokenize";

const spec = { fontFamily: "Test", fontWeight: 800, fontSizePx: 65, trackingEm: -0.04 };
const measurer = createFakeMeasurer(spec);
const opts = { measurer, maxWidthPx: 888, maxLines: 2 };

/** Vérifie qu'aucun mot n'est fragmenté : lignes recomposées = texte source. */
function expectNoWordCut(text: string, lines: string[]) {
  expect(lines.join(" ").replace(/\s+/g, " ").trim()).toBe(text.replace(/\s+/g, " ").trim());
  for (const line of lines) {
    expect(line).not.toMatch(/^\s|\s$/);
  }
}

describe("mesure de largeur en pixels", () => {
  it("mesure déterministe et croissante avec la longueur", () => {
    expect(measurer.measure("ab")).toBeGreaterThan(measurer.measure("a"));
    expect(measurer.measure("mmmm")).toBeGreaterThan(measurer.measure("iiii"));
  });
  it("prend en compte accents, apostrophes, chiffres et ponctuation", () => {
    expect(measurer.measure("écouté !")).toBeGreaterThan(0);
    expect(measurer.measure("j'ai 45 %")).toBeGreaterThan(measurer.measure("j'ai"));
  });
  it("le tracking négatif réduit la largeur", () => {
    const noTracking = createFakeMeasurer({ ...spec, trackingEm: 0 });
    expect(measurer.measure("bonjour tout le monde")).toBeLessThan(noTracking.measure("bonjour tout le monde"));
  });
});

describe("découpe en deux lignes maximum", () => {
  it("laisse une phrase courte sur une ligne", () => {
    const r = breakIntoLines("Bonjour à tous", opts);
    expect(r.lines).toEqual(["Bonjour à tous"]);
    expect(r.overflow).toBe(false);
  });

  it("ne produit jamais plus de deux lignes", () => {
    const r = breakIntoLines("Je pense que l'organisation fonctionne très bien ici", opts);
    expect(r.lines.length).toBeLessThanOrEqual(2);
  });

  it("ne coupe jamais un mot en deux", () => {
    const text = "Je pense que l'organisation fonctionne parfaitement bien";
    const r = breakIntoLines(text, opts);
    expectNoWordCut(text, r.lines);
  });

  it("ne sépare jamais une construction à apostrophe", () => {
    const text = "Je pense que l'organisation fonctionne";
    const r = breakIntoLines(text, opts);
    expect(r.lines.length).toBe(2);
    for (const line of r.lines) {
      // Aucune ligne ne finit par un mot élidé orphelin (l', j', qu'…)
      expect(line).not.toMatch(new RegExp(`\\p{L}+[${"'’"}]$`, "u"));
    }
    // l'organisation reste entière sur une seule ligne
    const holder = r.lines.find((l) => l.includes("organisation"));
    expect(holder).toMatch(/l['’]organisation/);
  });

  it("garde un nombre et son unité ensemble", () => {
    const text = "La température est de 20 °C aujourd'hui dans la vallée";
    const r = breakIntoLines(text, opts);
    const holder = r.lines.find((l) => l.includes("20"));
    expect(holder).toContain("20 °C");
  });

  it("garde une expression horaire ensemble", () => {
    const text = "Nous arriverons à 7 h 30 devant le bâtiment principal";
    const r = breakIntoLines(text, opts);
    const holder = r.lines.find((l) => l.includes("7"));
    expect(holder).toContain("7 h 30");
  });

  it("garde un nom propre multi-mots du glossaire ensemble", () => {
    const text = "On a tourné cette séquence avec Adobe Premiere Pro pour le montage final";
    const r = breakIntoLines(text, { ...opts, glossary: ["Adobe Premiere Pro"] });
    const holder = r.lines.find((l) => l.includes("Adobe"));
    expect(holder).toContain("Adobe Premiere Pro");
  });

  it("signale l'overflow au lieu de créer trois lignes ou masquer", () => {
    const text =
      "Ceci est une phrase excessivement longue qui ne peut absolument pas tenir sur deux lignes de sous-titres verticaux avec cette taille de police énorme";
    const r = breakIntoLines(text, opts);
    expect(r.overflow).toBe(true);
  });

  it("aucune ligne ne commence par une ponctuation", () => {
    const text = "On a fini, je crois, la partie la plus difficile du chantier";
    const r = breakIntoLines(text, opts);
    for (const line of r.lines) expect(line).not.toMatch(/^[,;:!?.]/);
  });
});

describe("score linguistique des coupes", () => {
  it("pénalise un mot faible en fin de première ligne", () => {
    // Largeur généreuse : seule la linguistique départage les deux coupes.
    const wide = { ...opts, maxWidthPx: 3000 };
    const text = "Nous irons au marché de la ville demain matin ensemble";
    const posAfterDe = text.indexOf("la ville"); // couper après « de »
    const posAfterMarche = text.indexOf(" de la");
    const scoreWeak = scoreBreak(text, posAfterDe, wide);
    const scoreStrong = scoreBreak(text, posAfterMarche + 1, wide);
    expect(scoreStrong).toBeGreaterThan(scoreWeak);
  });

  it("favorise une coupe après ponctuation", () => {
    const text = "On a terminé la première étape, la suite arrive bientôt";
    const afterComma = text.indexOf(", la suite") + 2;
    const midClause = text.indexOf("première");
    expect(scoreBreak(text, afterComma, opts)).toBeGreaterThan(scoreBreak(text, midClause, opts));
  });

  it("favorise des largeurs équilibrées", () => {
    const text = "une phrase moyenne qui se coupe proprement en deux parties égales";
    const r = breakIntoLines(text, { ...opts, maxWidthPx: 1100 });
    expect(r.lines).toHaveLength(2);
    const [w1, w2] = r.lines.map((l) => measurer.measure(l));
    expect(Math.abs(w1 - w2) / Math.max(w1, w2)).toBeLessThan(0.7);
  });

  it("produit des coupes différentes quand la taille de police change", () => {
    const text = "Je pense que l'organisation fonctionne parfaitement bien dans ce contexte précis";
    const small = createFakeMeasurer({ ...spec, fontSizePx: 40 });
    const rBig = breakIntoLines(text, opts);
    const rSmall = breakIntoLines(text, { ...opts, measurer: small });
    expect(rSmall.lines).not.toEqual(rBig.lines);
  });

  it("produit des coupes différentes quand la largeur max change", () => {
    const text = "Je pense que l'organisation fonctionne parfaitement bien dans ce contexte précis";
    const rWide = breakIntoLines(text, { ...opts, maxWidthPx: 2000 });
    const rNarrow = breakIntoLines(text, opts);
    expect(rWide.lines).not.toEqual(rNarrow.lines);
  });
});

describe("exemples génériques du cahier des charges", () => {
  it("« Je pense que l' / organisation » est interdit", () => {
    const r = breakIntoLines("Je pense que l'organisation fonctionne", opts);
    expect(r.lines[0]).not.toMatch(new RegExp(`[${"'’"}]$`));
  });

  it("« de 20 / °C » est interdit", () => {
    const r = breakIntoLines("La température est de 20 °C aujourd'hui", opts);
    for (const line of r.lines) expect(line).not.toMatch(/^°C/);
  });

  it("« à 7 h / 30 » est interdit", () => {
    const r = breakIntoLines("Nous arriverons à 7 h 30 devant le bâtiment", opts);
    for (const line of r.lines) expect(line).not.toMatch(/^30\b/);
  });
});

// Garde-fou : la regex d'apostrophes couvre droite et typographique.
describe("apostrophes", () => {
  it("APOSTROPHES couvre ' et ’", () => {
    expect(APOSTROPHES.test("'")).toBe(true);
    expect(APOSTROPHES.test("’")).toBe(true);
  });
});
