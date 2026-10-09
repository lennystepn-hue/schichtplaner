"use client";

import { useCallback, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import { isNavActive, navFooterItems, navGroups } from "./nav-config";
import { UserMenu } from "./user-menu";

const SPEICHER_SCHLUESSEL = "akro:sidebar-eingeklappt";

// Kleiner Speicher ausserhalb von React: der eingeklappte Zustand gehoert
// zum Browser des Nutzers, nicht zum Server.
const zuhoerer = new Set<() => void>();

function abonnieren(cb: () => void) {
  zuhoerer.add(cb);
  return () => {
    zuhoerer.delete(cb);
  };
}

function melden() {
  zuhoerer.forEach((cb) => cb());
}

function leseZustand(): boolean {
  try {
    return window.localStorage.getItem(SPEICHER_SCHLUESSEL) === "1";
  } catch {
    // Ohne Browser-Speicher bleibt die Leiste ausgeklappt.
    return false;
  }
}

/** Gemeinsame Form aller Eintraege auf der Schiene. */
function eintragKlassen(active: boolean, collapsed: boolean) {
  return cn(
    "relative flex items-center gap-3 rounded-[var(--radius)] py-2 text-[13.5px] font-medium transition-colors",
    collapsed ? "justify-center px-0" : "px-3",
    active
      ? "bg-[var(--schiene-aktiv)] text-[color:var(--schiene-text)]"
      : "text-[color:var(--schiene-gedimmt)] hover:bg-[var(--schiene-flaeche)] hover:text-[color:var(--schiene-text)]"
  );
}

/**
 * Linke Navigationsschiene ab Tablet-Breite. Sie ist die dunkle
 * Strukturflaeche der Oberflaeche: Navigation und Konto liegen hier,
 * die Arbeitsflaeche rechts daneben bleibt hell und ruhig.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { data: me } = useCurrentMember();
  const unread = useUnreadCount();
  const collapsed = useSyncExternalStore(
    abonnieren,
    leseZustand,
    () => false
  );

  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(SPEICHER_SCHLUESSEL, collapsed ? "0" : "1");
    } catch {
      // Nicht speicherbar ist kein Fehler, nur nicht gemerkt.
    }
    melden();
  }, [collapsed]);

  const groups = navGroups(me);
  const footer = navFooterItems(me);

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "akro-schiene akro-auf-marke sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[var(--schiene-linie)] md:flex",
        collapsed ? "w-[68px]" : "w-[228px]"
      )}
    >
      {/* Markenlinie, durchgehend mit der Kopfschiene. */}
      <div className="akro-markenlinie h-[2px]" aria-hidden="true" />

      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-[var(--schiene-linie)]",
          collapsed ? "justify-center px-2" : "justify-between px-4"
        )}
      >
        <Link
          href="/dashboard"
          className="flex items-center"
          aria-label="AKRO Schichtplaner - zur Startseite"
        >
          <Image
            src="/akro/img/akro-wortmarke.svg"
            alt=""
            width={115}
            height={30}
            priority
            className={cn(
              "akro-marke-hell w-auto",
              collapsed ? "h-[16px]" : "h-[19px]"
            )}
          />
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={toggle}
            className="rounded-[var(--radius)] p-1.5 text-[color:var(--schiene-gedimmt)] transition-colors hover:bg-[var(--schiene-flaeche)] hover:text-[color:var(--schiene-text)]"
            aria-label="Navigation einklappen"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {groups.map((group) => (
          <div key={group.title} className="mb-5 last:mb-0">
            {collapsed ? (
              <div
                className="mx-3 mb-2 h-px bg-[var(--schiene-linie)]"
                aria-hidden="true"
              />
            ) : (
              <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-[0.06em] text-[color:var(--schiene-gedimmt)] uppercase opacity-70">
                {group.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(item.href, pathname);
                const count = item.badge === "unread" ? unread : 0;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={eintragKlassen(active, collapsed)}
                    >
                      {/* Aktiv: schmale Markenkante statt Farbflaeche. */}
                      {active && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-[var(--brand)]"
                        />
                      )}
                      <Icon className="size-[18px] shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {count > 0 && (
                        <span
                          className={cn(
                            "akro-kennzahl flex min-w-5 items-center justify-center rounded-full bg-[var(--brand)] px-1.5 py-0.5 text-[11px] text-white",
                            collapsed ? "absolute top-0.5 right-2 min-w-4 px-1" : "ml-auto"
                          )}
                        >
                          {count > 99 ? "99+" : count}
                          <span className="sr-only"> ungelesene Nachrichten</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div
        className={cn(
          "shrink-0 border-t border-[var(--schiene-linie)] py-2",
          collapsed ? "px-1" : "px-2"
        )}
      >
        {footer.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(item.href, pathname);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(eintragKlassen(active, collapsed), "mb-1")}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-[var(--brand)]"
                />
              )}
              <Icon className="size-[18px] shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}

        <UserMenu collapsed={collapsed} dunkel />

        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            className="mt-1 flex w-full justify-center rounded-[var(--radius)] p-2 text-[color:var(--schiene-gedimmt)] transition-colors hover:bg-[var(--schiene-flaeche)] hover:text-[color:var(--schiene-text)]"
            aria-label="Navigation ausklappen"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
