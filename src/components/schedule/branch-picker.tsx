"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorMessage, json } from "@/components/workforce/client";

type BranchOption = { id: string; name: string; isActive: boolean; customer: { id: string; name: string } | null };

/**
 * Auswahl der Standorte, deren Plan die angemeldete Person sehen darf -
 * gruppiert nach Kunde. Ziel ist der Monatsplan oder der Wochenplan.
 */
export function BranchPicker({ href, title = "Standort wählen" }: { href: (branchId: string) => string; title?: string }) {
  const query = useQuery({
    queryKey: ["branches", "VIEW_SCHEDULE"],
    queryFn: () => json<{ branches: BranchOption[] }>("/api/branches?right=VIEW_SCHEDULE"),
  });
  if (query.error) return <ErrorMessage error={query.error} />;
  if (!query.data) {
    return (
      <div className="akro-panel space-y-3 p-4" aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  const branches = query.data.branches;
  const groups = new Map<string, { name: string; branches: BranchOption[] }>();
  for (const b of branches) {
    const key = b.customer?.id ?? "";
    if (!groups.has(key)) groups.set(key, { name: b.customer?.name ?? "Ohne Kunde (noch zuzuordnen)", branches: [] });
    groups.get(key)!.branches.push(b);
  }
  const sorted = [...groups.entries()].sort(([a, x], [b, y]) => (a === "" ? 1 : b === "" ? -1 : x.name.localeCompare(y.name, "de")));

  return (
    <section className="space-y-3">
      <h1 className="text-[20px] font-semibold tracking-[-0.03em]">{title}</h1>
      {!branches.length ? (
        <div className="akro-panel p-5 text-[14px] text-muted-foreground">
          Für dich ist noch kein Standortplan freigegeben. Freigaben vergibt die Administration unter Mitarbeiter › Freigaben.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sorted.map(([key, group]) => (
            <div key={key || "ohne"} className="akro-panel overflow-hidden">
              <h2 className="akro-panel-kopf border-b px-4 py-2.5 text-[14px] font-semibold tracking-[-0.02em]">{group.name}</h2>
              <ul className="divide-y divide-[var(--linie-fein)]">
                {group.branches.map((b) => (
                  <li key={b.id}>
                    <Link href={href(b.id)} className="flex items-center gap-3 px-4 py-3 text-[14px] transition-colors hover:bg-[var(--flaeche-kopf)]">
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                      {!b.isActive && <span className="text-[12px] text-muted-foreground">inaktiv</span>}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
