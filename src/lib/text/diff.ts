/** Diff mot à mot (LCS) pour surligner les corrections dans l'interface. */

export interface DiffPart {
  kind: "same" | "removed" | "added";
  text: string;
}

function splitWords(s: string): string[] {
  return s.split(/(\s+)/).filter((w) => w !== "");
}

export function wordDiff(a: string, b: string): DiffPart[] {
  const A = splitWords(a);
  const B = splitWords(b);
  const n = A.length;
  const m = B.length;
  // LCS dynamique.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("same", A[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("removed", A[i]);
      i++;
    } else {
      push("added", B[j]);
      j++;
    }
  }
  while (i < n) push("removed", A[i++]);
  while (j < m) push("added", B[j++]);
  return parts;
}
