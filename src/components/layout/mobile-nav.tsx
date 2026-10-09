"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { useUnreadCount } from "@/lib/hooks/use-unread-count";
import {
  isNavActive,
  mobileNavItems,
  navFooterItems,
  navGroups,
} from "./nav-config";

/**
 * Feste untere Navigation auf dem Handy: vier haeufige Ziele plus "Mehr".
 * Alles Weitere liegt im Sheet, gruppiert wie in der Seitenleiste.
 */
export function MobileNav() {
  const pathname = usePathname();
  const { data: me } = useCurrentMember();
  const unread = useUnreadCount();
  const [open, setOpen] = useState(false);

  const items = mobileNavItems(me);
  const groups = navGroups(me);
  const footer = navFooterItems(me);
  const hauptZiele = new Set(items.map((item) => item.href));

  const eintragKlasse = (active: boolean) =>
    cn(
      "relative flex h-full flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
      active ? "text-primary" : "text-muted-foreground"
    );

  return (
    <nav
      aria-label="Hauptnavigation"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = isNavActive(item.href, pathname);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={eintragKlasse(active)}
          >
            {/* Aktiv: schmale Markenkante, kein farbiger Kasten. */}
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-x-5 top-0 h-[2px] rounded-full bg-primary"
              />
            )}
            <Icon className="size-5" />
            {item.label}
          </Link>
        );
      })}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className={cn(eintragKlasse(false), "relative")}>
          <MoreHorizontal className="size-5" />
          Mehr
          {unread > 0 && (
            <span className="absolute top-2 right-1/4 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
              <span className="sr-only"> ungelesene Nachrichten</span>
            </span>
          )}
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-0">
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle>Alle Bereiche</SheetTitle>
          </SheetHeader>
          <div className="px-3 py-3">
            {groups.map((group) => {
              const weitere = group.items.filter(
                (item) => !hauptZiele.has(item.href)
              );
              if (weitere.length === 0) return null;
              return (
                <div key={group.title} className="mb-4 last:mb-0">
                  <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
                    {group.title}
                  </p>
                  <ul>
                    {weitere.map((item) => {
                      const Icon = item.icon;
                      const active = isNavActive(item.href, pathname);
                      const count = item.badge === "unread" ? unread : 0;
                      return (
                        <li key={item.key}>
                          <Link
                            href={item.href}
                            onClick={() => setOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-3 rounded-md px-3 py-3 text-[14px] font-medium",
                              active ? "bg-accent text-accent-foreground" : "text-foreground"
                            )}
                          >
                            <Icon className="size-5 text-muted-foreground" />
                            {item.label}
                            {count > 0 && (
                              <span className="ml-auto flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
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
              );
            })}

            {footer.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 border-t px-3 py-3 text-[14px] font-medium"
                >
                  <Icon className="size-5 text-muted-foreground" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
