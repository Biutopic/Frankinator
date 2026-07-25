import type { NextConfig } from "next";

/**
 * Deux modes de build :
 * - serveur (défaut)  : `npm run build` — la route /api/correct fonctionne
 *   avec ANTHROPIC_API_KEY côté serveur.
 * - statique (Pages)  : STATIC_EXPORT=1 — export HTML pur pour GitHub Pages ;
 *   la correction IA passe alors en mode navigateur (clé utilisateur locale).
 *   Le dossier src/app/api est retiré par le workflow avant ce build.
 */
const isStatic = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isStatic
    ? {
        output: "export" as const,
        basePath: process.env.PAGES_BASE_PATH || "",
        images: { unoptimized: true },
      }
    : {}),
  env: {
    NEXT_PUBLIC_STATIC_EXPORT: isStatic ? "1" : "0",
    NEXT_PUBLIC_BASE_PATH: isStatic ? process.env.PAGES_BASE_PATH || "" : "",
  },
};

export default nextConfig;
