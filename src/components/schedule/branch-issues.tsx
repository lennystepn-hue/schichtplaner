"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorMessage, json, selectClass, useAction } from "@/components/workforce/client";
import { cn } from "@/lib/utils";

type Issue = {
  id: string;
  title: string;
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  assignee: { id: string; user: { firstName: string; lastName: string } } | null;
  createdBy: { firstName: string; lastName: string } | null;
};
type Assignee = { memberId: string; name: string };

const STATUS: Record<Issue["status"], string> = { OPEN: "Offen", IN_PROGRESS: "In Bearbeitung", RESOLVED: "Erledigt" };

function zeit(value: string) {
  return new Date(value).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Interne Standortmeldungen - getrennt von offenen Plaetzen. Sichtbar und
 * bearbeitbar nur mit "Standortmeldungen bearbeiten"; die Pruefung liegt in
 * der API.
 */
export function BranchIssues({ branchId }: { branchId: string }) {
  const [alle, setAlle] = useState(false);
  const [neu, setNeu] = useState(false);
  const query = useQuery({
    queryKey: ["branch-issues", branchId, alle],
    queryFn: () => json<{ issues: Issue[]; assignees: Assignee[] }>(`/api/branches/${branchId}/issues${alle ? "?status=alle" : ""}`),
  });
  const action = useAction();
  const issues = query.data?.issues ?? [];
  const assignees = query.data?.assignees ?? [];

  return (
    <section className="akro-panel overflow-hidden" aria-labelledby="meldungen-titel">
      <div className="akro-panel-kopf flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 id="meldungen-titel" className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.02em]">
          <MessageSquareWarning className="size-4 text-muted-foreground" />
          Standortmeldungen
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" aria-pressed={alle} onClick={() => setAlle((v) => !v)}>{alle ? "Nur offene" : "Auch erledigte"}</Button>
          <Button size="sm" onClick={() => setNeu((v) => !v)}>{neu ? "Abbrechen" : "Meldung erfassen"}</Button>
        </div>
      </div>
      <ErrorMessage error={query.error} />
      {neu && (
        <form
          className="grid gap-3 border-b p-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await action.mutateAsync({ url: `/api/branches/${branchId}/issues`, data: { title: f.get("title"), description: f.get("description"), assigneeMemberId: f.get("assignee") || null }, message: "Meldung erfasst" }).then(() => setNeu(false)).catch(() => {});
          }}
        >
          <label className="text-[13px]">Titel<Input name="title" maxLength={160} required /></label>
          <label className="text-[13px]">Zuständig
            <select name="assignee" className={selectClass} defaultValue="">
              <option value="">Noch niemand</option>
              {assignees.map((p) => <option key={p.memberId} value={p.memberId}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-[13px] sm:col-span-2">Beschreibung<Textarea name="description" maxLength={5000} required /></label>
          <div className="sm:col-span-2"><Button disabled={action.isPending}>Speichern</Button></div>
        </form>
      )}
      {query.isPending ? (
        <p className="px-4 py-4 text-[14px] text-muted-foreground">Lädt …</p>
      ) : !issues.length ? (
        <p className="px-4 py-5 text-[14px] text-muted-foreground">{alle ? "Für diesen Standort gibt es keine Meldungen." : "Keine offenen Meldungen."}</p>
      ) : (
        <ul className="divide-y divide-[var(--linie-fein)]">
          {issues.map((issue) => (
            <li key={issue.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[14px] font-medium">{issue.title}</p>
                <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium", issue.status === "RESOLVED" ? "bg-muted text-muted-foreground" : issue.status === "IN_PROGRESS" ? "bg-accent text-accent-foreground" : "bg-warn/10 text-warn")}>
                  {STATUS[issue.status]}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[13.5px]">{issue.description}</p>
              <p className="tabular text-[12px] text-muted-foreground">
                Erfasst {zeit(issue.createdAt)}{issue.createdBy ? " von " + issue.createdBy.firstName + " " + issue.createdBy.lastName : ""}
                {issue.resolvedAt ? " · erledigt " + zeit(issue.resolvedAt) : issue.updatedAt !== issue.createdAt ? " · geändert " + zeit(issue.updatedAt) : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-2 text-[12.5px]">Status
                  <select className={cn(selectClass, "h-8 w-auto")} value={issue.status} disabled={action.isPending} onChange={(e) => action.mutate({ url: `/api/issues/${issue.id}`, method: "PATCH", data: { status: e.target.value }, message: "Status geändert" })}>
                    {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[12.5px]">Zuständig
                  <select className={cn(selectClass, "h-8 w-auto")} value={issue.assignee?.id ?? ""} disabled={action.isPending} onChange={(e) => action.mutate({ url: `/api/issues/${issue.id}`, method: "PATCH", data: { assigneeMemberId: e.target.value || null }, message: "Zuständigkeit geändert" })}>
                    <option value="">Noch niemand</option>
                    {assignees.map((p) => <option key={p.memberId} value={p.memberId}>{p.name}</option>)}
                    {issue.assignee && !assignees.some((p) => p.memberId === issue.assignee!.id) && <option value={issue.assignee.id}>{issue.assignee.user.firstName} {issue.assignee.user.lastName}</option>}
                  </select>
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
