import { describe, it, expect } from "vitest";
import { applyFrenchTypography } from "@/lib/text/typography";

const NBSP = " ";

describe("typographie française (règles génériques, aucun remplacement spécifique)", () => {
  it("20°C -> 20 °C", () => {
    expect(applyFrenchTypography("il fait 20°C")).toBe(`il fait 20${NBSP}°C`);
  });

  it("10km -> 10 km", () => {
    expect(applyFrenchTypography("encore 10km")).toBe(`encore 10${NBSP}km`);
  });

  it("7h30 -> 7 h 30", () => {
    expect(applyFrenchTypography("rendez-vous à 7h30")).toBe(`rendez-vous à 7${NBSP}h${NBSP}30`);
  });

  it("19h -> 19 h", () => {
    expect(applyFrenchTypography("on ferme à 19h")).toBe(`on ferme à 19${NBSP}h`);
  });

  it("normalise les apostrophes droites entre lettres", () => {
    expect(applyFrenchTypography("j'ai dit qu'on viendrait")).toBe("j’ai dit qu’on viendrait");
  });

  it("ajoute une insécable avant : ; ? !", () => {
    expect(applyFrenchTypography("Vraiment?")).toBe(`Vraiment${NBSP}?`);
    expect(applyFrenchTypography("Attention !")).toBe(`Attention${NBSP}!`);
    expect(applyFrenchTypography("deux choses: ceci")).toBe(`deux choses${NBSP}: ceci`);
  });

  it("pas d'espace avant virgule ni point", () => {
    expect(applyFrenchTypography("oui , bien sûr .")).toBe("oui, bien sûr.");
  });

  it("normalise les guillemets droits en guillemets français", () => {
    expect(applyFrenchTypography('il a dit "bonjour" hier')).toBe(`il a dit «${NBSP}bonjour${NBSP}» hier`);
  });

  it("préserve les majuscules accentuées", () => {
    expect(applyFrenchTypography("État des lieux")).toBe("État des lieux");
  });

  it("ne casse pas les heures numériques ni les URL", () => {
    expect(applyFrenchTypography("départ 10:30 pile")).toBe("départ 10:30 pile");
    expect(applyFrenchTypography("https://exemple.fr")).toContain("https://exemple.fr");
  });

  it("ne modifie pas la valeur des nombres", () => {
    expect(applyFrenchTypography("2,5 millions et 45%")).toContain("2,5 millions");
  });
});
