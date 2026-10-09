"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Pause, Plus, Users, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { EmployeePicker } from "./employee-picker";
import { WishRequestButton, WishCountBadge } from "./wish-plan";
import type { ShiftData, ScheduleLayout } from "@/types/schedule";
import type { WishRequest } from "./wish-plan";

interface ShiftCardProps {
  shift: ShiftData;
  onEdit: (shift: ShiftData) => void;
  /** Darf die angemeldete Person diese Schicht bearbeiten und besetzen? (aus shift.can) */
  canEdit: boolean;
  /** Current user's ID - needed for self-booking as employee */
  currentUserId?: string;
  /** If set, highlight shifts containing this user and dim others */
  highlightUserId?: string | null;
  /** Layout variant: LAYOUT_1 = shadow card, LAYOUT_2 = colored left border */
  layout?: ScheduleLayout;
  /** Whether to show shift titles */
  showTitle?: boolean;
  /** Whether to show pause information */
  showPauses?: boolean;
  /** Wish request for this shift by current user (employee view) */
  userWishRequest?: WishRequest | null;
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function ShiftCard({
  shift,
  onEdit,
  canEdit,
  currentUserId,
  highlightUserId,
  layout = "LAYOUT_1",
  showTitle = true,
  showPauses = true,
  userWishRequest,
}: ShiftCardProps) {
  const queryClient = useQueryClient();
  const bookedCount = shift.occupiedCount ?? shift.bookings.length;
  const isFull = bookedCount >= shift.maxEmployees;
  const emptySlots = Math.max(0, shift.maxEmployees - bookedCount);
  const divisionColor = shift.division?.color ?? "#94a3b8";

  // Highlight logic: when a filter is active, dim cards that don't contain the user
  const hasHighlightUser = highlightUserId
    ? shift.bookings.some((b) => b.userId === highlightUserId)
    : false;
  const isDimmed = highlightUserId ? !hasHighlightUser : false;

  const hasPause = shift.pauseValue > 0;
  const pauseLabel =
    shift.pauseOption === "PER_HOUR"
      ? `${shift.pauseValue} Min/Std`
      : `${shift.pauseValue} Min/Schicht`;

  // Book mutation
  const bookMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(canEdit ? "/api/bookings" : "/api/mod-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId: shift.id, userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Buchen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(canEdit ? "Mitarbeiter zugewiesen" : "Übernahme angefragt");
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Unbook mutation
  const unbookMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch("/api/bookings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId: shift.id, userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Abbuchen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Mitarbeiter abgebucht");
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Add place mutation
  const addPlaceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/shifts/${shift.id}/places`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Hinzufuegen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Platz hinzugefuegt");
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function handleBook(userId: string) {
    bookMutation.mutate(userId);
  }

  const isPending = bookMutation.isPending || unbookMutation.isPending || addPlaceMutation.isPending;
  const bookedUserIds = shift.bookings.map((b) => b.userId);

  // Can the current user book themselves into an empty slot?
  const canSelfBook =
    !canEdit &&
    !!shift.can?.request &&
    currentUserId &&
    !bookedUserIds.includes(currentUserId) &&
    !isFull;

  const isLayout1 = layout === "LAYOUT_1";
  const offeneBestätigungen = shift.bookings.filter((b) => !b.confirmedAt).length;

  return (
    <div
      className={cn(
        "group overflow-hidden rounded-[var(--radius)] border bg-card transition-colors",
        // Rangfolge: unbesetzt faellt auf, fehlende Bestätigung bleibt
        // dezent, vollstaendig besetzte Schichten bleiben ruhig.
        !isFull && "border-warn/50",
        isFull && offeneBestätigungen > 0 && "border-dashed",
        canEdit && "hover:border-primary/50",
        isPending && "opacity-70 pointer-events-none",
        isDimmed && "opacity-40",
        highlightUserId && hasHighlightUser && "border-primary"
      )}
      style={
        isLayout1
          ? {}
          : { borderLeftWidth: "3px", borderLeftColor: divisionColor }
      }
    >
      {/* Header - clickable for edit */}
      <button
        type="button"
        className={cn(
          "w-full space-y-1 px-2.5 py-2 text-left",
          canEdit && "cursor-pointer transition-colors hover:bg-[var(--flaeche-kopf)]"
        )}
        onClick={() => canEdit && onEdit(shift)}
        disabled={!canEdit}
      >
        {/* Kopfzeile: Zeit zuerst, dann die Besetzung.
            Besetzte Schichten bleiben ruhig, unbesetzte tragen das Signal -
            im Dienstplan zaehlt die Luecke, nicht die erledigte Zeile. */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="tabular text-[13px] leading-none font-semibold tracking-[-0.01em]">
            {shift.shiftFrom}
            <span className="text-muted-foreground">–</span>
            {shift.shiftTo}
          </span>
          <span
            className={cn(
              "tabular inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] leading-none font-medium",
              isFull
                ? "bg-muted text-muted-foreground"
                : "bg-warn/10 text-warn"
            )}
            title={
              isFull
                ? "Schicht vollstaendig besetzt"
                : `${emptySlots} Platz/Plätze noch offen`
            }
          >
            <Users className="size-3" />
            {bookedCount}/{shift.maxEmployees}
          </span>
        </div>

        {/* Einsatzort und Tätigkeit - Adresse, Treffpunkt und Hinweise
            stehen im Detailbereich, nicht auf jeder Karte. */}
        {shift.branch && (
          <div
            className="truncate text-[12.5px] leading-snug font-medium"
            title={shift.branch.name}
          >
            {shift.branch.name}
          </div>
        )}
        {(showTitle && shift.title) || shift.division ? (
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {shift.division && (
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: divisionColor }}
              />
            )}
            <span className="truncate">
              {[showTitle ? shift.title : null, shift.division?.title]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ) : null}

        {/* Nur der Hinweis, der eine Handlung ausloest. */}
        {canEdit && isFull && offeneBestätigungen > 0 && (
          <div className="text-[11px] text-muted-foreground">
            {offeneBestätigungen} Bestätigung(en) offen
          </div>
        )}
        {showPauses && hasPause && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Pause className="size-2.5" />
            {pauseLabel}
          </div>
        )}

        {/* Wish plan indicators */}
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {shift.can?.handle && (
            <WishCountBadge shiftId={shift.id} scheduleId={shift.scheduleId} />
          )}
          {!canEdit && shift.can?.request && currentUserId && !bookedUserIds.includes(currentUserId) && (
            <WishRequestButton
              shiftId={shift.id}
              currentUserId={currentUserId}
              existingRequest={userWishRequest}
            />
          )}
        </div>
      </button>

      {/* Content - employee slots */}
      <div className="space-y-0.5 px-2.5 pb-2">
        {/* Booked employees */}
        {shift.bookings.map((booking) => {
          const canUnbook = canEdit;
          return (
            <div
              key={booking.id}
              className={cn(
                "flex items-center gap-2 py-0.5 group/slot rounded-sm px-0.5 -mx-0.5",
                highlightUserId && booking.userId === highlightUserId && "bg-primary/10"
              )}
            >
              <Avatar size="sm">
                <AvatarFallback className="text-[9px]">
                  {getInitials(booking.user.firstName, booking.user.lastName)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-[12px]">
                {booking.user.firstName} {booking.user.lastName}
                {/* Nur fuer die Planung: zaehlt nicht als wirksame Besetzung. */}
                {booking.unavailable && (
                  <span className="ml-1 text-[11px] font-medium text-destructive">· nicht verfügbar</span>
                )}
              </span>
              {canUnbook && (
                <ConfirmDialog
                  title="Zuweisung aufheben"
                  description={`${booking.user.firstName} ${booking.user.lastName} wird aus dieser Schicht entfernt. Der Platz ist danach wieder offen.`}
                  confirmLabel="Entfernen"
                  onConfirm={() => unbookMutation.mutate(booking.userId)}
                >
                <button
                  type="button"
                  className="opacity-0 group-hover/slot:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  title="Abbuchen"
                  aria-label={`${booking.user.firstName} ${booking.user.lastName} aus der Schicht entfernen`}
                >
                  {unbookMutation.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <X className="size-3" />
                  )}
                </button>
                </ConfirmDialog>
              )}
            </div>
          );
        })}

        {/* Empty slots */}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <div key={`empty-${i}`}>
            {canEdit ? (
              <EmployeePicker
                bookedUserIds={bookedUserIds}
                onSelect={handleBook}
                shiftId={shift.id}
              >
                <button
                  type="button"
                  className="-mx-1 flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 transition-colors hover:bg-muted"
                >
                  <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border">
                    <Plus className="size-3 text-muted-foreground" />
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    Mitarbeiter zuweisen
                  </span>
                </button>
              </EmployeePicker>
            ) : canSelfBook && i === 0 ? (
              <button
                type="button"
                className="-mx-1 flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 transition-colors hover:bg-muted"
                onClick={() => currentUserId && handleBook(currentUserId)}
              >
                <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-primary/50">
                  <Plus className="size-3 text-primary" />
                </span>
                <span className="text-[12px] font-medium text-primary">
                  Übernahme anfragen
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2 py-0.5">
                <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-border">
                  <span className="text-[10px] text-muted-foreground" aria-hidden="true">
                    ?
                  </span>
                </span>
                <span className="text-[12px] text-muted-foreground">Frei</span>
              </div>
            )}
          </div>
        ))}

        {/* + Platz button for managers */}
        {canEdit && (
          <button
            type="button"
            className="flex w-full items-center gap-1.5 pt-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => addPlaceMutation.mutate()}
          >
            <Plus className="size-3" />
            Platz
          </button>
        )}
      </div>
    </div>
  );
}
