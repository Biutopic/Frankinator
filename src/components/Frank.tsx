"use client";

/**
 * Frank, la mascotte. Stickers WebP à fond transparent, animés en CSS.
 * Les assets vivent dans public/frank/ ; le préfixe basePath est géré
 * pour le déploiement GitHub Pages.
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const FRANK_ASSETS = {
  face: `${BASE}/frank/frank-face.webp`,
  pense: `${BASE}/frank/frank-pense.webp`,
  sourire: `${BASE}/frank/frank-sourire.webp`,
  video: `${BASE}/frank/frank-grain-de-sel.mp4`,
} as const;

type Kind = "face" | "pense" | "sourire";
type Anim = "bob" | "think" | "pop" | "none";

const ANIM_CLASS: Record<Anim, string> = {
  bob: "frank-bob",
  think: "frank-think",
  pop: "frank-pop",
  none: "",
};

export default function Frank({
  kind,
  anim = "bob",
  size = 56,
  className = "",
  title,
}: {
  kind: Kind;
  anim?: Anim;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={FRANK_ASSETS[kind]}
      alt={title ?? "Frank"}
      title={title}
      width={size}
      height={size}
      draggable={false}
      className={`select-none ${ANIM_CLASS[anim]} ${className}`}
      style={{ width: size, height: "auto" }}
    />
  );
}
