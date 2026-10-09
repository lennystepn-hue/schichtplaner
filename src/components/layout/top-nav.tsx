"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { seitenTitel } from "./nav-config";
import { UserMenu } from "./user-menu";
import { ConnectionStatus } from "./connection-status";

/** Weckt die Kopfschiene einmal pro Minute; kein Zustand in Effekten. */
function abonniereMinute(melden: () => void) {
  const id = window.setInterval(melden, 20_000);
  return () => window.clearInterval(id);
}

function minutenStempel(): string {
  const jetzt = new Date();
  return `${jetzt.getFullYear()}-${jetzt.getMonth()}-${jetzt.getDate()}-${jetzt.getHours()}-${jetzt.getMinutes()}`;
}

const datumsFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
});

/** Datum und Uhrzeit der Leitstelle. Vor dem ersten Rendern leer. */
function Dienstzeit() {
  const stempel = useSyncExternalStore(
    abonniereMinute,
    minutenStempel,
    () => ""
  );
  if (!stempel) return <span className="w-[8.5rem]" aria-hidden="true" />;

  const jetzt = new Date();
  return (
    <span className="tabular text-[13px] text-muted-foreground">
      {datumsFormat.format(jetzt)}
      <span className="px-1.5 text-border" aria-hidden="true">
        |
      </span>
      <span className="font-medium text-foreground">
        {zeitFormat.format(jetzt)}
      </span>
    </span>
  );
}

/**
 * Kopfschiene der Arbeitsoberflaeche. Auf dem Handy traegt sie die
 * Wortmarke, ab Tablet den Namen des aktuellen Bereichs - die
 * Navigation selbst steht dann links in der Seitenleiste.
 */
export function TopNav() {
  const pathname = usePathname();
  const { data: me } = useCurrentMember();
  const titel = seitenTitel(pathname, me);

  return (
    <header className="sticky top-0 z-30 border-b bg-card">
      {/* Markenlinie: das einzige Farbelement der Kopfschiene. */}
      <div className="akro-markenlinie h-[2px]" aria-hidden="true" />

      <div className="flex h-14 items-center gap-3 px-4 md:px-6 lg:px-8">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center md:hidden"
          aria-label="AKRO Schichtplaner - zur Startseite"
        >
          <Image
            src="/akro/img/akro-wortmarke.svg"
            alt=""
            width={115}
            height={30}
            priority
            className="h-[20px] w-auto"
          />
        </Link>

        <h2 className="hidden min-w-0 truncate text-[15px] leading-none font-semibold tracking-[-0.02em] md:block">
          {titel}
        </h2>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden md:block">
            <Dienstzeit />
          </span>
          <ConnectionStatus />
          <span className="md:hidden">
            <UserMenu />
          </span>
        </div>
      </div>
    </header>
  );
}
