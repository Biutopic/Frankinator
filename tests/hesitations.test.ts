import { describe, it, expect } from "vitest";
import { stripHesitations } from "@/lib/text/hesitations";

describe("suppression un-clic des hésitations", () => {
  it("retire « euh » en milieu de phrase", () => {
    expect(stripHesitations("on va euh continuer")).toBe("on va continuer");
  });

  it("retire les élongations (euuuh, heuuu)", () => {
    expect(stripHesitations("c'était euuuh compliqué")).toBe("c'était compliqué");
    expect(stripHesitations("c'était heuuu compliqué")).toBe("c'était compliqué");
  });

  it("retire « Euh, » en tête de phrase et remonte la majuscule", () => {
    expect(stripHesitations("Euh, on avait une équipe")).toBe("On avait une équipe");
    expect(stripHesitations("Hum, je crois")).toBe("Je crois");
  });

  it("nettoie la double virgule autour d'une hésitation incise", () => {
    expect(stripHesitations("on va, euh, continuer")).toBe("on va, continuer");
  });

  it("retire hum / hmm / mmh", () => {
    expect(stripHesitations("hmm je sais pas")).toBe("je sais pas");
    expect(stripHesitations("et hum voilà")).toBe("et voilà");
    expect(stripHesitations("mmh d'accord")).toBe("d'accord");
  });

  it("ne touche jamais aux mots contenant ces lettres (heure, humeur…)", () => {
    expect(stripHesitations("il est 19 heures")).toBe("il est 19 heures");
    expect(stripHesitations("de bonne humeur")).toBe("de bonne humeur");
    expect(stripHesitations("l'heure du départ")).toBe("l'heure du départ");
  });

  it("préserve les sauts de ligne du cue", () => {
    expect(stripHesitations("Euh, on avait\nune équipe")).toBe("On avait\nune équipe");
  });

  it("un cue réduit à une hésitation devient vide (signalé ailleurs)", () => {
    expect(stripHesitations("euh…")).toBe("");
  });

  it("texte sans hésitation inchangé à l'identique", () => {
    const t = "La température est de 20 °C aujourd'hui.";
    expect(stripHesitations(t)).toBe(t);
  });
});
