"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Star,
  Loader2,
  Check,
  X,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────

/** Antrag, wie die API ihn fuer die angemeldete Person ausgibt. */
export type WishRequest = {
  id: string;
  kind?: string;
  shiftId: string;
  /** Nur fuer eigene Antraege und fuer die Planung gesetzt. */
  userId: string | null;
  targetUserId?: string | null;
  state: "OPEN" | "ACCEPTED" | "DECLINED";
  note: string | null;
  sentAt: string;
  /** Name nur fuer Beteiligte und wer den Standortplan sehen darf. */
  user: { firstName: string; lastName: string } | null;
  can?: { decide: boolean; volunteer: boolean; withdraw: boolean };
  shift: {
    id: string;
    scheduleId: string;
    dayOfWeek: number;
    shiftFrom: string;
    shiftTo: string;
    title: string | null;
    date?: string;
    branch?: { name: string } | null;
    division?: {
      id: string;
      title: string;
      color: string;
    } | null;
  };
};

// ─── Employee: "Wunsch senden" Button ────────────────────────────────

interface WishRequestButtonProps {
  shiftId: string;
  currentUserId: string;
  /** Existing requests for this shift by this user */
  existingRequest?: WishRequest | null;
}

export function WishRequestButton({
  shiftId,
  currentUserId,
  existingRequest,
}: WishRequestButtonProps) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [note, setNote] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/mod-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shiftId,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Senden");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Wunsch gesendet");
      queryClient.invalidateQueries({ queryKey: ["mod-requests"] });
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      setDialogOpen(false);
      setNote("");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await fetch(`/api/mod-requests/${requestId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Stornieren");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Wunsch storniert");
      queryClient.invalidateQueries({ queryKey: ["mod-requests"] });
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // If there's already a request
  if (existingRequest) {
    const stateConfig = {
      OPEN: {
        icon: Clock,
        label: "Wunsch offen",
        color: "text-warn",
        bg: "bg-warn/10",
      },
      ACCEPTED: {
        icon: CheckCircle2,
        label: "Angenommen",
        color: "text-ok",
        bg: "bg-ok/10",
      },
      DECLINED: {
        icon: XCircle,
        label: "Abgelehnt",
        color: "text-destructive",
        bg: "bg-destructive/10",
      },
    };
    const config = stateConfig[existingRequest.state];
    const Icon = config.icon;

    return (
      <div className="flex items-center gap-1.5">
        <Badge
          variant="secondary"
          className={cn("text-[9px] px-1.5 py-0 gap-1", config.color, config.bg)}
        >
          <Icon className="size-2.5" />
          {config.label}
        </Badge>
        {existingRequest.state === "OPEN" && (
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive transition-colors"
            title="Wunsch stornieren"
            onClick={() => {
              if (confirm("Wunsch wirklich stornieren?")) {
                cancelMutation.mutate(existingRequest.id);
              }
            }}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <X className="size-3" />
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="flex items-center gap-1 text-[10px] text-warn hover:text-warn transition-colors"
        onClick={() => setDialogOpen(true)}
      >
        <Star className="size-3" />
        Wunsch
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Wunsch senden</DialogTitle>
            <DialogDescription>
              Sende einen Wunsch fuer diese Schicht. Dein Manager wird
              benachrichtigt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              placeholder="Optionaler Kommentar..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="resize-none min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
            >
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="gap-1.5"
            >
              {createMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Star className="size-3.5" />
              )}
              Wunsch senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Manager: Wish Count Badge ───────────────────────────────────────

interface WishCountBadgeProps {
  shiftId: string;
  scheduleId: string;
}

export function WishCountBadge({ shiftId, scheduleId }: WishCountBadgeProps) {
  const { data } = useQuery<{ requests: WishRequest[] }>({
    queryKey: ["mod-requests", scheduleId],
    queryFn: async () => {
      const res = await fetch(`/api/mod-requests?scheduleId=${scheduleId}`);
      if (!res.ok) return { requests: [] };
      return res.json();
    },
    enabled: !!scheduleId,
  });

  const requests = data?.requests ?? [];
  const shiftRequests = requests.filter(
    (r) => r.shiftId === shiftId && r.state === "OPEN" && r.can?.decide
  );

  if (shiftRequests.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative"
          onClick={(e) => e.stopPropagation()}
        >
          <Badge
            variant="secondary"
            className="text-[9px] px-1.5 py-0 gap-1 bg-warn/10 text-warn hover:bg-warn/10 cursor-pointer"
          >
            <Star className="size-2.5 fill-warn text-warn" />
            {shiftRequests.length}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <WishRequestsList
          requests={shiftRequests}
          scheduleId={scheduleId}
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Manager: Wish Requests List (inside popover) ────────────────────

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

interface WishRequestsListProps {
  requests: WishRequest[];
  scheduleId: string;
}

function WishRequestsList({ requests, scheduleId }: WishRequestsListProps) {
  const queryClient = useQueryClient();

  const acceptMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await fetch(`/api/mod-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "ACCEPTED" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Wunsch angenommen & Mitarbeiter gebucht");
      queryClient.invalidateQueries({ queryKey: ["mod-requests"] });
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await fetch(`/api/mod-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "DECLINED" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Wunsch abgelehnt");
      queryClient.invalidateQueries({ queryKey: ["mod-requests"] });
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const bulkAcceptMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        requests.map(async (r) => {
          const res = await fetch(`/api/mod-requests/${r.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: "ACCEPTED" }),
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Fehler");
          }
          return res.json();
        })
      );
      const accepted = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      return { accepted, failed };
    },
    onSuccess: (data) => {
      toast.success(
        `${data.accepted} Wuensche angenommen${data.failed > 0 ? `, ${data.failed} fehlgeschlagen` : ""}`
      );
      queryClient.invalidateQueries({ queryKey: ["mod-requests"] });
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: () => {
      toast.error("Fehler bei der Massenverarbeitung");
    },
  });

  const isPending =
    acceptMutation.isPending ||
    declineMutation.isPending ||
    bulkAcceptMutation.isPending;

  return (
    <div>
      <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
        <span className="text-xs font-semibold">
          {requests.length} {requests.length === 1 ? "Wunsch" : "Wuensche"}
        </span>
        {requests.length > 1 && (
          <Button
            variant="ghost"
            size="xs"
            className="text-[10px] gap-1 text-ok"
            onClick={() => bulkAcceptMutation.mutate()}
            disabled={isPending}
          >
            {bulkAcceptMutation.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Check className="size-3" />
            )}
            Alle annehmen
          </Button>
        )}
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {requests.map((req) => (
          <div
            key={req.id}
            className={cn(
              "px-3 py-2 border-b last:border-b-0 flex items-start gap-2",
              isPending && "opacity-60 pointer-events-none"
            )}
          >
            <Avatar size="sm" className="mt-0.5">
              <AvatarFallback className="text-[9px]">
                {req.user ? getInitials(req.user.firstName, req.user.lastName) : "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {req.user ? `${req.user.firstName} ${req.user.lastName}` : "Antrag"}
                {req.kind === "SWAP" && <span className="font-normal text-muted-foreground"> · Tausch</span>}
              </div>
              {req.note && (
                <div className="flex items-start gap-1 mt-0.5">
                  <MessageSquare className="size-2.5 text-muted-foreground mt-0.5 shrink-0" />
                  <span className="text-[10px] text-muted-foreground line-clamp-2">
                    {req.note}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className="size-6 rounded-md flex items-center justify-center bg-ok/10 text-ok hover:bg-ok/10 transition-colors"
                title="Annehmen"
                onClick={() => acceptMutation.mutate(req.id)}
                disabled={isPending}
              >
                {acceptMutation.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
              </button>
              <button
                type="button"
                className="size-6 rounded-md flex items-center justify-center bg-destructive/10 text-destructive hover:bg-destructive/10 transition-colors"
                title="Ablehnen"
                onClick={() => declineMutation.mutate(req.id)}
                disabled={isPending}
              >
                {declineMutation.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <X className="size-3" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Wish Filter Toggle ──────────────────────────────────────────────

interface WishFilterToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  wishCount: number;
}

export function WishFilterToggle({
  enabled,
  onToggle,
  wishCount,
}: WishFilterToggleProps) {
  if (wishCount === 0) return null;

  return (
    <Button
      variant={enabled ? "default" : "outline"}
      size="sm"
      className={cn(
        "gap-1.5",
        enabled
          ? "bg-warn hover:bg-warn"
          : "border-warn/40 text-warn hover:bg-warn/10"
      )}
      onClick={() => onToggle(!enabled)}
    >
      <Star className={cn("size-3.5", enabled && "fill-white")} />
      Wuensche
      <Badge
        variant="secondary"
        className={cn(
          "text-[9px] px-1 py-0 ml-0.5",
          enabled ? "bg-warn text-white" : "bg-warn/10 text-warn"
        )}
      >
        {wishCount}
      </Badge>
    </Button>
  );
}
