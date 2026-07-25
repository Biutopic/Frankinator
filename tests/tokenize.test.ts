import { describe, it, expect } from "vitest";
import { tokenize, words, isApostropheConstruction } from "@/lib/text/tokenize";

describe("tokenisation française des apostrophes", () => {
  const constructions = ["j'ai", "l'arrivée", "qu'on", "c'est", "d'abord", "n'est", "s'il", "jusqu'à", "puisqu'il"];

  it("garde les constructions élidées indivisibles (apostrophe droite)", () => {
    for (const c of constructions) {
      expect(words(`On sait que ${c} demain`)).toContain(c);
    }
  });

  it("supporte l'apostrophe typographique (')", () => {
    for (const c of constructions) {
      const typo = c.replace("'", "’");
      expect(words(`On sait que ${typo} demain`)).toContain(typo);
    }
  });

  it("identifie une construction à apostrophe", () => {
    expect(isApostropheConstruction("j'ai")).toBe(true);
    expect(isApostropheConstruction("l’arrivée")).toBe(true);
    expect(isApostropheConstruction("bonjour")).toBe(false);
  });

  it("garde les mots composés entiers", () => {
    expect(words("Jean-Pierre arrive aujourd'hui")).toEqual(["Jean-Pierre", "arrive", "aujourd'hui"]);
  });

  it("préserve les positions de départ", () => {
    const t = tokenize("j'ai faim");
    expect(t[0].text).toBe("j'ai");
    expect(t[0].start).toBe(0);
    expect(t[2].text).toBe("faim");
  });

  it("garde les nombres décimaux entiers", () => {
    expect(words("environ 2,5 millions")).toContain("2,5");
  });
});
