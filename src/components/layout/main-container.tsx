"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Seiten, die die volle Arbeitsbreite brauchen (Raster, Tabellen). */
const BREITE_BEREICHE = ["/schedule", "/reporting", "/time", "/employees"];

/**
 * Inhaltsbreite nach Seitenart: Planung und Tabellen nutzen die Flaeche
 * neben der Seitenleiste, Formular- und Textseiten bleiben schmaler und
 * damit lesbar. Unten bleibt auf dem Handy Platz für die feste Leiste.
 */
export function MainContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const breit = BREITE_BEREICHE.some(
    (bereich) => pathname === bereich || pathname.startsWith(bereich + "/")
  );

  return (
    <main
      id="inhalt"
      className={cn(
        "mx-auto w-full px-4 pt-5 pb-24 md:px-6 md:pb-8 lg:px-8",
        breit ? "max-w-[1920px]" : "max-w-[1344px]"
      )}
    >
      {children}
    </main>
  );
}
