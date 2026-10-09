"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Radio,
  Square,
  Loader2,
  Clock,
  UserPlus,
  UserMinus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSocket, useSocketEvent } from "@/lib/socket";
import { dayNames } from "@/lib/utils/calendar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LiveDayData = {
  id: string;
  liveSessionId: string;
  dayOfWeek: number;
  enabled: boolean;
};

type LiveLogUser = {
  id: string;
  firstName: string;
  lastName: string;
};

type LiveLogData = {
  id: string;
  liveSessionId: string;
  shiftId: string;
  userId: string;
  action: "BOOK" | "UNBOOK";
  loggedAt: string;
  user: LiveLogUser;
};

type LiveSessionData = {
  id: string;
  scheduleId: string;
  isActive: boolean;
  startedAt: string;
  deadline: string | null;
  autoStop: boolean;
  allowExceeds: boolean;
  bookRequests: boolean;
  days: LiveDayData[];
  logs: LiveLogData[];
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LiveModeProps {
  scheduleId: string;
  isManager: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LiveMode({ scheduleId, isManager }: LiveModeProps) {
  const queryClient = useQueryClient();
  const { joinSchedule, leaveSchedule } = useSocket();
  const [expanded, setExpanded] = useState(false);

  // Join schedule room for real-time updates
  useEffect(() => {
    if (scheduleId) {
      joinSchedule(scheduleId);
      return () => leaveSchedule(scheduleId);
    }
  }, [scheduleId, joinSchedule, leaveSchedule]);

  // Fetch live session
  const { data, isLoading } = useQuery<{ session: LiveSessionData | null }>({
    queryKey: ["live-session", scheduleId],
    queryFn: async () => {
      const res = await fetch(`/api/live?scheduleId=${scheduleId}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Live-Session");
      return res.json();
    },
    enabled: !!scheduleId,
  });

  const session = data?.session ?? null;
  const isActive = session?.isActive ?? false;

  // Listen for live socket events and refresh data
  const handleLiveEvent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["live-session", scheduleId] });
    queryClient.invalidateQueries({ queryKey: ["schedule"] });
  }, [queryClient, scheduleId]);

  useSocketEvent("live:started", handleLiveEvent);
  useSocketEvent("live:stopped", handleLiveEvent);
  useSocketEvent("live:updated", handleLiveEvent);
  useSocketEvent("live:booking", handleLiveEvent);

  // Start live mode mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Starten");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Live-Modus gestartet");
      queryClient.invalidateQueries({ queryKey: ["live-session", scheduleId] });
      setExpanded(true);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Stop live mode mutation
  const stopMutation = useMutation({
    mutationFn: async () => {
      if (!session) return;
      const res = await fetch(`/api/live?id=${session.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Stoppen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Live-Modus gestoppt");
      queryClient.invalidateQueries({ queryKey: ["live-session", scheduleId] });
      setExpanded(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const isPending = startMutation.isPending || stopMutation.isPending;

  if (isLoading) {
    return null; // Don't flash anything while loading
  }

  return (
    <div className="flex flex-col">
      {/* Live Mode Toggle Button */}
      <div className="flex items-center gap-2">
        {isManager && (
          <>
            {!isActive ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-[var(--brand)] hover:bg-accent hover:text-[var(--brand)]"
                onClick={() => startMutation.mutate()}
                disabled={isPending}
              >
                {startMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Radio className="size-3.5" />
                )}
                Live starten
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  if (confirm("Live-Modus wirklich stoppen?")) {
                    stopMutation.mutate();
                  }
                }}
                disabled={isPending}
              >
                {stopMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Square className="size-3.5" />
                )}
                Live stoppen
              </Button>
            )}
          </>
        )}

        {/* Live indicator badge */}
        {isActive && (
          <button
            type="button"
            className="flex items-center gap-1.5"
            onClick={() => setExpanded((prev) => !prev)}
          >
            <Badge variant="default" className="cursor-pointer gap-1.5">
              {/* Ruhiger Punkt statt Blinken - der Zustand ist dauerhaft. */}
              <span
                aria-hidden="true"
                className="inline-flex size-2 rounded-full bg-white"
              />
              LIVE
              {expanded ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </Badge>
          </button>
        )}
      </div>

      {/* Expanded Live Panel */}
      {isActive && expanded && session && (
        <LivePanel
          session={session}
          isManager={isManager}
          scheduleId={scheduleId}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Panel (expanded details)
// ---------------------------------------------------------------------------

function LivePanel({
  session,
  isManager,
  scheduleId,
}: {
  session: LiveSessionData;
  isManager: boolean;
  scheduleId: string;
}) {
  const queryClient = useQueryClient();

  return (
    <div className="mt-3 rounded-lg border-2 text-[var(--brand)] bg-accent/50 p-4 space-y-4">
      {/* Timer */}
      <LiveTimer startedAt={session.startedAt} />

      {/* Day toggles - manager only */}
      {isManager && (
        <DayToggles
          sessionId={session.id}
          days={session.days}
          scheduleId={scheduleId}
        />
      )}

      {/* Day status - employee view */}
      {!isManager && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">
            Offen:
          </span>
          {session.days.map((day) => (
            <Badge
              key={day.id}
              variant={day.enabled ? "default" : "secondary"}
              className={cn(
                "text-xs",
                day.enabled
                  ? "text-[var(--brand)] hover:text-[var(--brand)]"
                  : "opacity-50"
              )}
            >
              {dayNames[day.dayOfWeek - 1]}
            </Badge>
          ))}
        </div>
      )}

      {/* Live Log */}
      <LiveLogFeed logs={session.logs ?? []} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Timer
// ---------------------------------------------------------------------------

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    const start = new Date(startedAt).getTime();

    function update() {
      const diff = Date.now() - start;
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);

      const parts: string[] = [];
      if (hours > 0) parts.push(`${hours}h`);
      parts.push(`${String(minutes).padStart(2, "0")}m`);
      parts.push(`${String(seconds).padStart(2, "0")}s`);
      setElapsed(parts.join(" "));
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <div className="flex items-center gap-2 text-sm text-[var(--brand)]">
      <Clock className="size-4" />
      <span className="tabular font-medium">{elapsed}</span>
      <span className="text-xs text-muted-foreground">aktiv</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day Toggles (Manager only)
// ---------------------------------------------------------------------------

function DayToggles({
  sessionId,
  days,
  scheduleId,
}: {
  sessionId: string;
  days: LiveDayData[];
  scheduleId: string;
}) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: async ({
      dayOfWeek,
      enabled,
    }: {
      dayOfWeek: number;
      enabled: boolean;
    }) => {
      const res = await fetch(`/api/live?id=${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: [{ dayOfWeek, enabled }],
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Aendern");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live-session", scheduleId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[var(--brand)]">
        Tage fuer Self-Booking:
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        {days.map((day) => (
          <div key={day.id} className="flex items-center gap-1.5">
            <Switch
              size="sm"
              checked={day.enabled}
              onCheckedChange={(checked) =>
                toggleMutation.mutate({
                  dayOfWeek: day.dayOfWeek,
                  enabled: checked,
                })
              }
              disabled={toggleMutation.isPending}
            />
            <Label className="text-xs cursor-pointer">
              {dayNames[day.dayOfWeek - 1]}
            </Label>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Log Feed
// ---------------------------------------------------------------------------

function LiveLogFeed({ logs }: { logs: LiveLogData[] }) {
  if (logs.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-2">
        Noch keine Aktivitaet
      </div>
    );
  }

  return (
    <div className="space-y-1.5 max-h-48 overflow-y-auto">
      <p className="text-xs font-medium text-[var(--brand)]">Aktivitaet:</p>
      {logs.map((log) => (
        <div
          key={log.id}
          className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-card/60"
        >
          {log.action === "BOOK" ? (
            <UserPlus className="size-3 text-ok shrink-0" />
          ) : (
            <UserMinus className="size-3 text-destructive shrink-0" />
          )}
          <span className="font-medium">
            {log.user.firstName} {log.user.lastName}
          </span>
          <span className="text-muted-foreground">
            {log.action === "BOOK" ? "eingetragen" : "ausgetragen"}
          </span>
          <span className="ml-auto text-muted-foreground shrink-0">
            {formatTime(log.loggedAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Live Mode border wrapper for schedule grid
// ---------------------------------------------------------------------------

export function LiveBorder({
  isActive,
  children,
}: {
  isActive: boolean;
  children: React.ReactNode;
}) {
  if (!isActive) return <>{children}</>;

  return (
    <div className="relative">
      {/* Ruhige Markenkante statt Dauerpulsieren - die Live-Sitzung ist
          ein Zustand, kein Alarm. */}
      <div className="pointer-events-none absolute inset-0 z-10 rounded-[var(--radius-panel)] border-2 border-[var(--brand)]" />
      {children}
    </div>
  );
}
