"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { json, useAction, ErrorMessage } from "@/components/workforce/client";
type Running = { startedAt: string; pauseStartedAt: string | null; breakSeconds: number; timeFrom: string };
export function Stopwatch() {
  const q = useQuery({ queryKey: ["time-watch"], queryFn: () => json<{ running: Running | null }>("/api/time/watch"), refetchInterval: 15000 }), action = useAction();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const r = q.data?.running;
  const seconds = r ? Math.max(0, Math.floor(((r.pauseStartedAt ? Date.parse(r.pauseStartedAt) : now) - Date.parse(r.startedAt)) / 1000) - r.breakSeconds) : 0;
  const elapsed = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2,"0")).join(":");
  return <Card className="p-5 space-y-4"><h3 className="text-[14px] font-semibold tracking-[-0.02em]">Arbeitszeit erfassen</h3><ErrorMessage error={q.error} /><p className="text-4xl tabular-nums font-semibold text-primary">{elapsed}</p><p className="text-sm text-muted-foreground">{r ? r.pauseStartedAt ? "Pause läuft · Arbeitszeit angehalten" : "Arbeitsbeginn " + r.timeFrom + " Uhr" : "Bereit für deinen Arbeitsbeginn"}</p><div className="flex flex-wrap gap-2">{(r ? [r.pauseStartedAt ? "RESUME" : "PAUSE", "STOP"] : ["START"]).map(a => <Button key={a} disabled={q.isPending || !!q.error || action.isPending} variant={a === "STOP" ? "outline" : "default"} onClick={() => action.mutate({ url: "/api/time/watch", data: { action: a } })}>{{ START: "Arbeitsbeginn", PAUSE: "Pause beginnen", RESUME: "Pause beenden", STOP: "Arbeitsende" }[a]}</Button>)}</div></Card>;
}
