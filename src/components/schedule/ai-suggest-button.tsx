"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  Check,
  X,
  CheckCheck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────

interface Suggestion {
  shiftId: string;
  employeeId: string;
  employeeName: string;
  employeeImage: string | null;
  score: number;
  reason: string;
}

interface AISuggestButtonProps {
  scheduleId: string;
}

// ─── Score color helper ─────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return "bg-ok/10 text-ok border-ok/40";
  if (score >= 60) return "bg-warn/10 text-warn border-warn/40";
  return "bg-destructive/10 text-destructive border-destructive/40";
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Sehr gut";
  if (score >= 60) return "Gut";
  if (score >= 40) return "Mittel";
  return "Niedrig";
}

// ─── Main component ─────────────────────────────────────────────────

export function AISuggestButton({ scheduleId }: AISuggestButtonProps) {
  const queryClient = useQueryClient();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [declinedIds, setDeclinedIds] = useState<Set<string>>(new Set());

  // ── Generate suggestions ────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/suggest-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "KI-Vorschlag fehlgeschlagen");
      }

      return res.json() as Promise<{ suggestions: Suggestion[] }>;
    },
    onSuccess: (data) => {
      setSuggestions(data.suggestions);
      setAcceptedIds(new Set());
      setDeclinedIds(new Set());

      if (data.suggestions.length === 0) {
        toast.info("Keine Vorschlaege: Alle Schichten sind bereits besetzt.");
      } else {
        setSheetOpen(true);
        toast.success(
          `${data.suggestions.length} KI-Vorschlaege generiert`
        );
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // ── Accept a single suggestion (create booking) ─────────────────

  const acceptMutation = useMutation({
    mutationFn: async (suggestion: Suggestion) => {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shiftId: suggestion.shiftId,
          userId: suggestion.employeeId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Buchung fehlgeschlagen");
      }

      return suggestion;
    },
    onSuccess: (suggestion) => {
      setAcceptedIds((prev) => new Set([...prev, suggestionKey(suggestion)]));
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      toast.success(`${suggestion.employeeName} gebucht`);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // ── Accept all pending suggestions ──────────────────────────────

  const acceptAllMutation = useMutation({
    mutationFn: async () => {
      const pending = suggestions.filter(
        (s) =>
          !acceptedIds.has(suggestionKey(s)) &&
          !declinedIds.has(suggestionKey(s))
      );

      const results: Suggestion[] = [];
      for (const suggestion of pending) {
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shiftId: suggestion.shiftId,
            userId: suggestion.employeeId,
          }),
        });

        if (res.ok) {
          results.push(suggestion);
        }
      }

      return results;
    },
    onSuccess: (accepted) => {
      const newAccepted = new Set(acceptedIds);
      for (const s of accepted) {
        newAccepted.add(suggestionKey(s));
      }
      setAcceptedIds(newAccepted);
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      toast.success(`${accepted.length} Vorschlaege uebernommen`);
    },
    onError: () => {
      toast.error("Fehler beim Uebernehmen der Vorschlaege");
    },
  });

  // ── Decline a suggestion ────────────────────────────────────────

  function handleDecline(suggestion: Suggestion) {
    setDeclinedIds((prev) => new Set([...prev, suggestionKey(suggestion)]));
  }

  // ── Helpers ─────────────────────────────────────────────────────

  function suggestionKey(s: Suggestion): string {
    return `${s.shiftId}:${s.employeeId}`;
  }

  const pendingCount = suggestions.filter(
    (s) =>
      !acceptedIds.has(suggestionKey(s)) && !declinedIds.has(suggestionKey(s))
  ).length;

  const isProcessing =
    generateMutation.isPending ||
    acceptMutation.isPending ||
    acceptAllMutation.isPending;

  // ── Render ──────────────────────────────────────────────────────

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => generateMutation.mutate()}
        disabled={isProcessing}
      >
        {generateMutation.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        KI-Vorschlag
      </Button>

      {/* Suggestions Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="flex flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-[var(--brand)]" />
              KI-Vorschlaege
            </SheetTitle>
            <SheetDescription>
              {suggestions.length} Vorschlaege generiert.{" "}
              {pendingCount > 0
                ? `${pendingCount} ausstehend.`
                : "Alle bearbeitet."}
            </SheetDescription>
          </SheetHeader>

          {/* Suggestion list */}
          <div className="flex-1 overflow-y-auto px-4 space-y-3 py-2">
            {suggestions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <AlertTriangle className="size-8 mb-2" />
                <p className="text-sm">Keine Vorschlaege verfuegbar.</p>
              </div>
            )}

            {suggestions.map((suggestion) => {
              const key = suggestionKey(suggestion);
              const isAccepted = acceptedIds.has(key);
              const isDeclined = declinedIds.has(key);
              const isDone = isAccepted || isDeclined;

              return (
                <div
                  key={key}
                  className={cn(
                    "rounded-lg border p-3 transition-all",
                    isAccepted && "bg-ok/10/50 border-ok/40 opacity-75",
                    isDeclined && "bg-muted/50 opacity-50",
                    !isDone && "bg-card hover:shadow-sm"
                  )}
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Avatar placeholder */}
                      <div className="size-8 rounded-full text-[var(--brand)] flex items-center justify-center shrink-0">
                        <span className="text-xs font-medium text-[var(--brand)]">
                          {suggestion.employeeName
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {suggestion.employeeName}
                        </p>
                      </div>
                    </div>

                    {/* Score badge */}
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-xs font-semibold",
                        scoreColor(suggestion.score)
                      )}
                    >
                      {suggestion.score} - {scoreLabel(suggestion.score)}
                    </Badge>
                  </div>

                  {/* Reason */}
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    {suggestion.reason}
                  </p>

                  {/* Status / Actions */}
                  {isAccepted ? (
                    <div className="flex items-center gap-1.5 text-xs text-ok">
                      <Check className="size-3.5" />
                      Uebernommen
                    </div>
                  ) : isDeclined ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <X className="size-3.5" />
                      Abgelehnt
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => acceptMutation.mutate(suggestion)}
                        disabled={isProcessing}
                      >
                        <Check className="size-3" />
                        Akzeptieren
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1 text-muted-foreground"
                        onClick={() => handleDecline(suggestion)}
                        disabled={isProcessing}
                      >
                        <X className="size-3" />
                        Ablehnen
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer with "Accept All" */}
          <SheetFooter className="flex-row gap-2 px-4">
            {pendingCount > 0 && (
              <Button
                variant="default"
                size="sm"
                className="gap-1.5"
                onClick={() => acceptAllMutation.mutate()}
                disabled={isProcessing}
              >
                {acceptAllMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="size-3.5" />
                )}
                Alle akzeptieren ({pendingCount})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSheetOpen(false)}
              className="ml-auto"
            >
              Schliessen
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
