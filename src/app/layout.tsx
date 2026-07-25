import type { Metadata } from "next";
import { Anybody } from "next/font/google";
import "./globals.css";

// Police par défaut du preset « Reel Instagram — Premiere » : chargée pour
// que la mesure Canvas et l'aperçu utilisent la vraie fonte.
const anybody = Anybody({
  subsets: ["latin"],
  variable: "--font-anybody",
  weight: ["400", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Frankinator — Tes sous-titres passent à la moulinette de Frank.",
  description:
    "Importe, corrige, formate et exporte des sous-titres SRT propres, prêts pour Adobe Premiere Pro.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`${anybody.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
