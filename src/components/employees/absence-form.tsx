"use client";

import { useState } from "react";
import { berlinDate } from "@/lib/berlin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Check, X } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentMember } from "@/lib/hooks/use-current-member";

// ---------- Types ----------

type AbsenceCategory = {
  id: string;
  name: string;
  color: string;
  isPaid: boolean;
};

type AbsenceData = {
  id: string;
  userId: string;
  categoryId: string;
  dateFrom: string;
  dateTo: string;
  note: string | null;
  status: "PENDING" | "APPROVED" | "DECLINED";
  user: {
    id: string;
    firstName: string;
    lastName: string;
  };
  category: AbsenceCategory;
  /** Vom Server: darf die angemeldete Person diesen Antrag entscheiden? */
  canDecide?: boolean;
};

type EmployeeOption = {
  userId: string;
  firstName: string;
  lastName: string;
};

interface AbsenceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  absence?: AbsenceData | null;
  employees?: EmployeeOption[];
  defaultDateFrom?: string;
  defaultDateTo?: string;
}

// ---------- Helpers ----------

function calculateDays(from: string, to: string): number {
  const dateFrom = new Date(from);
  const dateTo = new Date(to);
  if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) return 0;
  const diffTime = dateTo.getTime() - dateFrom.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "PENDING":
      return (
        <Badge className="bg-warn/10 text-warn dark:bg-warn/20 dark:text-warn">
          Ausstehend
        </Badge>
      );
    case "APPROVED":
      return (
        <Badge className="bg-ok/10 text-ok dark:bg-ok/20 dark:text-ok">
          Genehmigt
        </Badge>
      );
    case "DECLINED":
      return (
        <Badge className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
          Abgelehnt
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

// ---------- Component ----------

export function AbsenceForm(props: AbsenceFormProps) {
  const { data: member } = useCurrentMember();
  if (!member) return null;
  return props.open ? <AbsenceEditor key={props.absence?.id || "new"} {...props} /> : null;
}
function AbsenceEditor({
  open,
  onOpenChange,
  absence,
  employees = [],
  defaultDateFrom,
  defaultDateTo,
}: AbsenceFormProps) {
  const isEdit = !!absence;
  const queryClient = useQueryClient();
  const { data: currentMember } = useCurrentMember();

  // Form state
  const [userId, setUserId] = useState(absence?.userId || currentMember?.user.id || "");
  const [categoryId, setCategoryId] = useState(absence?.categoryId || "");
  const [dateFrom, setDateFrom] = useState(
    absence?.dateFrom.slice(0,10) || defaultDateFrom || berlinDate()
  );
  const [dateTo, setDateTo] = useState(
    absence?.dateTo.slice(0,10) || defaultDateTo || berlinDate()
  );
  const [note, setNote] = useState(absence?.note || "");

  // Fetch categories
  const { data: categoriesData } = useQuery<{ categories: AbsenceCategory[] }>({
    queryKey: ["absence-categories"],
    queryFn: async () => {
      const res = await fetch("/api/absences/categories");
      if (!res.ok) throw new Error("Failed to fetch categories");
      return res.json();
    },
  });

  const categories = categoriesData?.categories ?? [];

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          categoryId,
          dateFrom,
          dateTo,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Erstellen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Abwesenheit erstellt");
      queryClient.invalidateQueries({ queryKey: ["absences"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (!absence) return;
      const res = await fetch(`/api/absences/${absence.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Fehler beim Speichern");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Abwesenheit aktualisiert");
      queryClient.invalidateQueries({ queryKey: ["absences"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const days = calculateDays(dateFrom, dateTo);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      toast.error("Bitte eine Kategorie waehlen");
      return;
    }
    if (days <= 0) {
      toast.error("Ungueltige Datumsauswahl");
      return;
    }
    if (isEdit) {
      updateMutation.mutate({
        categoryId,
        dateFrom,
        dateTo,
        note: note.trim() || null,
      });
    } else {
      createMutation.mutate();
    }
  }

  function handleApprove() {
    if (!absence) return;
    updateMutation.mutate({ status: "APPROVED" });
  }

  function handleDecline() {
    if (!absence) return;
    updateMutation.mutate({ status: "DECLINED" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Abwesenheit bearbeiten" : "Abwesenheit beantragen"}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Bearbeite die Abwesenheitsanfrage."
                : "Erstelle eine neue Abwesenheitsanfrage."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {/* Status badge for existing absences */}
            {isEdit && absence && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Status:</span>
                {getStatusBadge(absence.status)}
                {absence.user && (
                  <span className="text-sm text-muted-foreground ml-auto">
                    {absence.user.lastName}, {absence.user.firstName}
                  </span>
                )}
              </div>
            )}

            {/* Personenauswahl nur, wenn neben der eigenen Person weitere freigegeben sind */}
            {!isEdit && employees.length > 1 && (
              <div className="space-y-1.5">
                <Label>Mitarbeiter</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Mitarbeiter waehlen" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.userId} value={emp.userId}>
                        {emp.lastName}, {emp.firstName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Category select */}
            <div className="space-y-1.5">
              <Label>Kategorie</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Kategorie waehlen" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <div className="flex items-center gap-2">
                        <span
                          className="size-3 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span>{cat.name}</span>
                        {!cat.isPaid && (
                          <span className="text-xs text-muted-foreground">
                            (unbezahlt)
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="absence-from">Von</Label>
                <Input
                  id="absence-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="absence-to">Bis</Label>
                <Input
                  id="absence-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Days count */}
            {days > 0 && (
              <p className="text-sm text-muted-foreground">
                {days} Tag{days !== 1 ? "e" : ""}
              </p>
            )}

            {/* Note */}
            <div className="space-y-1.5">
              <Label htmlFor="absence-note">Notiz (optional)</Label>
              <Textarea
                id="absence-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Grund der Abwesenheit..."
                rows={2}
                maxLength={500}
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <div className="flex items-center gap-2 w-full">
              {/* Genehmigen/Ablehnen nur mit dem Recht fuer genau diese Person */}
              {isEdit && absence?.canDecide && absence.status === "PENDING" && (
                <div className="flex gap-2 mr-auto">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleApprove}
                    disabled={isPending}
                    className="text-ok border-ok/40 hover:bg-ok/10 dark:hover:bg-ok/20"
                  >
                    <Check className="size-4" />
                    Genehmigen
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDecline}
                    disabled={isPending}
                    className="text-destructive border-destructive/40 hover:bg-destructive/10 dark:hover:bg-destructive/20"
                  >
                    <X className="size-4" />
                    Ablehnen
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isPending}
                >
                  Abbrechen
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  {isEdit ? "Speichern" : "Beantragen"}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { getStatusBadge, calculateDays };
export type { AbsenceData, AbsenceCategory, EmployeeOption };
