"use client";

import dynamic from "next/dynamic";

// L'application manipule localStorage et Canvas : rendu client uniquement.
const App = dynamic(() => import("@/components/App"), { ssr: false });

export default function Home() {
  return <App />;
}
