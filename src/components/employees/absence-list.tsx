"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Plus,
  Check,
  X,
  Trash2,
  Pencil,
  CalendarDays,
  Clock,
  Search,
  Filter,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { AbsenceForm, getStatusBadge, calculateDays } from "./absence-form";
import type { AbsenceData, EmployeeOption } from "./absence-form";

// ---------- Types ----------

type AbsenceResponse = {
  absences: AbsenceData[];
  canManage: boolean;
  /** Eigene Person plus zugeordnete Personen, fuer die Eintraege erlaubt sind. */
  people: EmployeeOption[];
  counts: {
    all: number;
    pending: number;
    approved: number;
    declined: number;
  };
};

type FilterTab = "all" | "pending" | "approved" | "declined";

// ---------- Helpers ----------

const tabs: { key: FilterTab; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "pending", label: "Ausstehend" },
  { key: "approved", label: "Genehmigt" },
  { key: "declined", label: "Abgelehnt" },
];

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function formatDateRange(from: string, to: string): string {
  const dateFrom = new Date(from);
  const dateTo = new Date(to);
  if (from.slice(0, 10) === to.slice(0, 10)) {
    return format(dateFrom, "dd.MM.yyyy");
  }
  return `${format(dateFrom, "dd.MM.")} - ${format(dateTo, "dd.MM.yyyy")}`;
}

// ---------- Component ----------

export function AbsenceList() {
  const queryClient = useQueryClient();
  const { data: currentMember } = useCurrentMember();

  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingAbsence, setEditingAbsence] = useState<AbsenceData | null>(null);

  // Build query params
  const queryParams = new URLSearchParams();
  if (activeTab !== "all") {
    queryParams.set("status", activeTab.toUpperCase());
  }

  // Fetch absences
  const { data, isLoading, error } = useQuery<AbsenceResponse>({
    queryKey: ["absences", activeTab],
    queryFn: async () => {
      const res = await fetch(`/api/absences?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Abwesenheiten");
      return res.json();
    },
  });

  const absences = data?.absences ?? [];
  const counts = data?.counts ?? { all: 0, pending: 0, approved: 0, declined: 0 };

  // Filter by search
  const filteredAbsences = useMemo(() => {
    if (!search) return absences;
    const q = search.toLowerCase();
    return absences.filter(
      (a) =>
        a.user.firstName.toLowerCase().includes(q) ||
        a.user.lastName.toLowerCase().includes(q) ||
        a.category.name.toLowerCase().includes(q)
    );
  }, [absences, search]);

  // Personen fuer das Formular - vom Server nach Freigabe begrenzt
  const employeeOptions: EmployeeOption[] = data?.people ?? [];

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/absences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "APPROVED" }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Fehler beim Genehmigen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Abwesenheit genehmigt");
      queryClient.invalidateQueries({ queryKey: ["absences"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Decline mutation
  const declineMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/absences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DECLINED" }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Fehler beim Ablehnen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Abwesenheit abgelehnt");
      queryClient.invalidateQueries({ queryKey: ["absences"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/absences/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Fehler beim Löschen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Abwesenheit gelöscht");
      queryClient.invalidateQueries({ queryKey: ["absences"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const LOESCH_HINWEIS =
    "Der Eintrag wird entfernt. Ein genehmigter Zeitraum gilt danach nicht mehr als Abwesenheit.";

  function handleEdit(absence: AbsenceData) {
    setEditingAbsence(absence);
    setShowForm(true);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">Abwesenheiten</h1>
          <p className="text-sm text-muted-foreground">
            Abwesenheitsanfragen verwalten und genehmigen
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditingAbsence(null);
            setShowForm(true);
          }}
        >
          <Plus className="size-4" />
          Abwesenheit beantragen
        </Button>
      </div>

      {/* Search + Filter Tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche nach Name oder Kategorie..."
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => {
            const count = counts[tab.key] ?? 0;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-primary dark:text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {tab.key === "pending" && (
                  <Clock className="size-3.5 text-warn" />
                )}
                {tab.key === "approved" && (
                  <Check className="size-3.5 text-ok" />
                )}
                {tab.key === "declined" && (
                  <X className="size-3.5 text-destructive" />
                )}
                {tab.key === "all" && (
                  <Filter className="size-3.5" />
                )}
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="tabular-nums text-xs opacity-70">
                  ({count})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <Card className="p-6 text-center text-destructive">
          Fehler beim Laden der Abwesenheiten. Bitte versuche es erneut.
        </Card>
      )}

      {/* Loading */}
      {isLoading && <AbsenceListSkeleton />}

      {/* Empty state */}
      {!isLoading && !error && filteredAbsences.length === 0 && (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <CalendarDays className="size-12 text-muted-foreground/50 mb-3" />
          <p className="text-lg font-medium">Keine Abwesenheiten</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search
              ? "Keine Ergebnisse für die Suche."
              : "Noch keine Abwesenheitsanfragen vorhanden."}
          </p>
        </Card>
      )}

      {/* Desktop Table */}
      {!isLoading && !error && filteredAbsences.length > 0 && (
        <>
          <Card className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mitarbeiter</TableHead>
                  <TableHead>Kategorie</TableHead>
                  <TableHead>Zeitraum</TableHead>
                  <TableHead className="text-center">Tage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAbsences.map((absence) => {
                  const days = calculateDays(absence.dateFrom, absence.dateTo);
                  const canDelete =
                    !!absence.canDecide ||
                    (absence.userId === currentMember?.user.id &&
                      absence.status === "PENDING");

                  return (
                    <TableRow key={absence.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar>
                            <AvatarFallback className="text-xs">
                              {getInitials(
                                absence.user.firstName,
                                absence.user.lastName
                              )}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {absence.user.lastName}, {absence.user.firstName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="size-3 rounded-full shrink-0"
                            style={{ backgroundColor: absence.category.color }}
                          />
                          <span>{absence.category.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDateRange(absence.dateFrom, absence.dateTo)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {days}
                      </TableCell>
                      <TableCell>{getStatusBadge(absence.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1 justify-end">
                          {/* Quick approve/decline for admins on pending */}
                          {absence.canDecide && absence.status === "PENDING" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => approveMutation.mutate(absence.id)}
                                disabled={approveMutation.isPending}
                                title="Genehmigen"
                              >
                                <Check className="size-3.5 text-ok" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => declineMutation.mutate(absence.id)}
                                disabled={declineMutation.isPending}
                                title="Ablehnen"
                              >
                                <X className="size-3.5 text-destructive" />
                              </Button>
                            </>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => handleEdit(absence)}
                              title="Bearbeiten"
                            >
                              <Pencil className="size-3" />
                            </Button>
                          )}
                          {canDelete && (
                            <ConfirmDialog
                              title="Abwesenheit löschen"
                              description={LOESCH_HINWEIS}
                              confirmLabel="Löschen"
                              disabled={deleteMutation.isPending}
                              onConfirm={() => deleteMutation.mutate(absence.id)}
                            >
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              disabled={deleteMutation.isPending}
                              title="Löschen"
                            >
                              <Trash2 className="size-3 text-destructive" />
                            </Button>
                            </ConfirmDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile Cards */}
          <div className="space-y-2 md:hidden">
            {filteredAbsences.map((absence) => {
              const days = calculateDays(absence.dateFrom, absence.dateTo);
              const canDelete =
                !!absence.canDecide ||
                (absence.userId === currentMember?.user.id &&
                  absence.status === "PENDING");

              return (
                <Card key={absence.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Avatar>
                        <AvatarFallback className="text-xs">
                          {getInitials(
                            absence.user.firstName,
                            absence.user.lastName
                          )}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">
                          {absence.user.lastName}, {absence.user.firstName}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: absence.category.color }}
                          />
                          <span className="text-xs text-muted-foreground">
                            {absence.category.name}
                          </span>
                        </div>
                      </div>
                    </div>
                    {getStatusBadge(absence.status)}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-sm text-muted-foreground tabular-nums">
                      {formatDateRange(absence.dateFrom, absence.dateTo)}
                      <span className="ml-2">
                        ({days} Tag{days !== 1 ? "e" : ""})
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {absence.canDecide && absence.status === "PENDING" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => approveMutation.mutate(absence.id)}
                          >
                            <Check className="size-3.5 text-ok" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => declineMutation.mutate(absence.id)}
                          >
                            <X className="size-3.5 text-destructive" />
                          </Button>
                        </>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleEdit(absence)}
                          title="Bearbeiten"
                        >
                          <Pencil className="size-3" />
                        </Button>
                      )}
                      {canDelete && (
                        <ConfirmDialog
                          title="Abwesenheit löschen"
                          description={LOESCH_HINWEIS}
                          confirmLabel="Löschen"
                          onConfirm={() => deleteMutation.mutate(absence.id)}
                        >
                          <Button variant="ghost" size="icon-xs" title="Löschen">
                            <Trash2 className="size-3 text-destructive" />
                          </Button>
                        </ConfirmDialog>
                      )}
                    </div>
                  </div>
                  {absence.note && (
                    <p className="mt-2 text-xs text-muted-foreground border-t pt-2">
                      {absence.note}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Absence form dialog */}
      <AbsenceForm
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open);
          if (!open) setEditingAbsence(null);
        }}
        absence={editingAbsence}
        employees={employeeOptions}
      />
    </div>
  );
}

function AbsenceListSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="p-4 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}
