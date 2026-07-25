"use client";

import { wordDiff } from "@/lib/text/diff";

/** Affiche les différences mot à mot entre deux textes. */
export default function DiffText({ from, to }: { from: string; to: string }) {
  const parts = wordDiff(from, to);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.kind === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "removed" ? (
          <span key={i} className="diff-removed">
            {p.text}
          </span>
        ) : (
          <span key={i} className="diff-added">
            {p.text}
          </span>
        )
      )}
    </span>
  );
}
