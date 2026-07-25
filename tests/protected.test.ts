import { describe, it, expect } from "vitest";
import { detectProtectedRanges, breakSplitsProtected } from "@/lib/text/protected";

function protectedTexts(text: string, custom: string[] = [], glossary: string[] = []) {
  return detectProtectedRanges(text, custom, glossary).map((r) => text.slice(r.start, r.end));
}

describe("détection d'expressions protégées", () => {
  it("détecte les heures", () => {
    expect(protectedTexts("rendez-vous à 7 h 30 ce matin").join(" ")).toContain("7 h 30");
    expect(protectedTexts("rendez-vous à 7h30 ce matin").join(" ")).toContain("7h30");
  });

  it("détecte les températures et unités", () => {
    expect(protectedTexts("il fait 20 °C dehors").join(" ")).toContain("20 °C");
    expect(protectedTexts("encore 15 km à faire").join(" ")).toContain("15 km");
    expect(protectedTexts("soit 45 % du total").join(" ")).toContain("45 %");
  });

  it("détecte les montants et quantités", () => {
    expect(protectedTexts("un budget de 3 € par jour").join(" ")).toContain("3 €");
    expect(protectedTexts("près de 2,5 millions d'habitants").join(" ")).toContain("2,5 millions");
  });

  it("groupe les noms propres composés", () => {
    expect(protectedTexts("avec Jean-Pierre demain").join(" ")).toContain("Jean-Pierre");
  });

  it("groupe les noms propres multi-mots", () => {
    expect(protectedTexts("je pars à New York demain").join(" ")).toContain("New York");
    expect(protectedTexts("monté dans Adobe Premiere Pro hier").join(" ")).toContain("Adobe Premiere Pro");
  });

  it("détecte téléphones, URL et e-mails", () => {
    expect(protectedTexts("appelle le 06 12 34 56 78 vite").length).toBeGreaterThan(0);
    expect(protectedTexts("va sur https://exemple.fr/page maintenant").join(" ")).toContain("https://exemple.fr/page");
    expect(protectedTexts("écris à contact@exemple.fr merci").join(" ")).toContain("contact@exemple.fr");
  });

  it("détecte les dates", () => {
    expect(protectedTexts("on lance le 14 juillet 2026 au matin").join(" ")).toContain("14 juillet 2026");
  });

  it("protège les expressions personnalisées et le glossaire", () => {
    expect(protectedTexts("avec l'équipe du grand bleu profond", ["grand bleu profond"]).join(" ")).toContain(
      "grand bleu profond"
    );
    expect(protectedTexts("le projet hydronaute avance", [], ["hydronaute"]).join(" ")).toContain("hydronaute");
  });

  it("breakSplitsProtected refuse une coupe au milieu d'une plage", () => {
    const text = "il fait 20 °C dehors";
    const ranges = detectProtectedRanges(text);
    const inside = text.indexOf("°C"); // couper juste avant °C = scinder « 20 °C »
    expect(breakSplitsProtected(inside, ranges)).toBe(true);
    expect(breakSplitsProtected(0, ranges)).toBe(false);
  });

  it("fusionne les plages qui se chevauchent", () => {
    const ranges = detectProtectedRanges("à 7 h 30 min pile");
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].start).toBeGreaterThanOrEqual(ranges[i - 1].end);
    }
  });
});
