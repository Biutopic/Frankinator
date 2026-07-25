/** Conversion des timecodes SRT (HH:MM:SS,mmm) <-> millisecondes. */

const STRICT_RE = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/;
/** Variante tolérante à l'import (chiffres manquants, point décimal). */
const LOOSE_RE = /^(\d{1,3}):([0-5]?\d):([0-5]?\d)[,.](\d{1,3})$/;

export function parseTimecode(raw: string): number | null {
  const m = raw.trim().match(LOOSE_RE);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return (
    Number(h) * 3_600_000 +
    Number(min) * 60_000 +
    Number(s) * 1000 +
    Number(ms.padEnd(3, "0"))
  );
}

/** true si le timecode respecte strictement le format SRT (virgule incluse). */
export function isStrictTimecode(raw: string): boolean {
  return STRICT_RE.test(raw.trim()) && raw.includes(",");
}

export function formatTimecode(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  ms = Math.round(ms);
  const h = Math.floor(ms / 3_600_000);
  const min = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(min)}:${p(s)},${p(rest, 3)}`;
}
