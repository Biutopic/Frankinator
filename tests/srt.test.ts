import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parseSrt } from "@/lib/srt/parse";
import { serializeSrt } from "@/lib/srt/serialize";
import { parseTimecode, formatTimecode } from "@/lib/srt/timecode";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", name), "utf-8");

describe("conversion de timecodes", () => {
  it("convertit HH:MM:SS,mmm en millisecondes", () => {
    expect(parseTimecode("00:00:01,000")).toBe(1000);
    expect(parseTimecode("01:02:03,456")).toBe(3_723_456);
  });
  it("tolère le point décimal et les chiffres manquants à l'import", () => {
    expect(parseTimecode("0:0:1.5")).toBe(1500);
  });
  it("rejette les timecodes invalides", () => {
    expect(parseTimecode("abc")).toBeNull();
    expect(parseTimecode("00:99:00,000")).toBeNull();
  });
  it("aller-retour ms -> texte -> ms", () => {
    for (const ms of [0, 999, 1000, 3_723_456, 86_399_999]) {
      expect(parseTimecode(formatTimecode(ms))).toBe(ms);
    }
  });
  it("formate toujours avec une virgule", () => {
    expect(formatTimecode(1500)).toBe("00:00:01,500");
  });
});

describe("parsing SRT", () => {
  it("parse un fichier valide sans erreur", () => {
    const { cues, issues } = parseSrt(fixture("generic.srt"));
    expect(cues).toHaveLength(4);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(cues[0].startMs).toBe(1000);
    expect(cues[0].endMs).toBe(3500);
    expect(cues[0].originalText).toBe("Bonjour à tous et bienvenue");
    expect(cues[0].correctedText).toBe(cues[0].originalText);
  });

  it("ne jette jamais silencieusement un bloc : tout est signalé", () => {
    const { cues, issues } = parseSrt(fixture("broken.srt"));
    // Le bloc corrompu est signalé en erreur avec son contenu.
    expect(issues.some((i) => i.severity === "error" && i.message.includes("corrompu"))).toBe(true);
    // Les blocs récupérables sont conservés.
    expect(cues.length).toBeGreaterThanOrEqual(5);
  });

  it("détecte les index dupliqués", () => {
    const { issues } = parseSrt(fixture("broken.srt"));
    expect(issues.some((i) => i.message.includes("dupliqué"))).toBe(true);
  });

  it("détecte les chevauchements", () => {
    const { issues } = parseSrt(fixture("broken.srt"));
    expect(issues.some((i) => i.message.includes("Chevauchement"))).toBe(true);
  });

  it("détecte les sous-titres vides et fins invalides", () => {
    const { cues } = parseSrt(fixture("broken.srt"));
    expect(cues.some((c) => c.warnings.some((w) => w.includes("vide")))).toBe(true);
    expect(cues.some((c) => c.warnings.some((w) => w.includes("antérieure")))).toBe(true);
  });

  it("signale un fichier vide", () => {
    const { cues, issues } = parseSrt("");
    expect(cues).toHaveLength(0);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("signale un encodage cassé (mojibake)", () => {
    const { issues } = parseSrt("1\n00:00:01,000 --> 00:00:02,000\nÃ©tÃ©\n");
    expect(issues.some((i) => i.message.includes("encodage") || i.message.includes("UTF-8"))).toBe(true);
  });

  it("gère les CRLF et le BOM", () => {
    const { cues } = parseSrt("﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nSalut\r\n");
    expect(cues).toHaveLength(1);
    expect(cues[0].originalText).toBe("Salut");
  });
});

describe("sérialisation SRT", () => {
  it("renumérote séquentiellement à partir de 1", () => {
    const { cues } = parseSrt(fixture("broken.srt"));
    const round = parseSrt(serializeSrt(cues));
    const indexes = round.cues.map((c) => c.id).sort((a, b) => a - b);
    expect(indexes).toEqual(indexes.map((_, i) => i + 1));
  });

  it("utilise la virgule pour les millisecondes", () => {
    const { cues } = parseSrt(fixture("generic.srt"));
    const out = serializeSrt(cues);
    expect(out).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);
    expect(out).not.toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it("préserve les caractères accentués (UTF-8)", () => {
    const src = "1\n00:00:01,000 --> 00:00:02,000\nL'été à Nîmes, ça caille : -5 °C !\n";
    const { cues } = parseSrt(src);
    const out = serializeSrt(cues);
    expect(out).toContain("L'été à Nîmes, ça caille : -5 °C !");
  });

  it("aller-retour parse -> serialize -> parse stable", () => {
    const { cues } = parseSrt(fixture("generic.srt"));
    const round = parseSrt(serializeSrt(cues));
    expect(round.cues.map((c) => c.originalText)).toEqual(cues.map((c) => c.originalText));
    expect(round.cues.map((c) => c.startMs)).toEqual(cues.map((c) => c.startMs));
  });

  it("utilise formattedLines quand demandé", () => {
    const { cues } = parseSrt(fixture("generic.srt"));
    cues[0].formattedLines = ["Bonjour à tous", "et bienvenue"];
    const out = serializeSrt(cues, { useFormattedLines: true });
    expect(out).toContain("Bonjour à tous\net bienvenue");
  });
});
