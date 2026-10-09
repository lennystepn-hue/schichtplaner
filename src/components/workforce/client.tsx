"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
export async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Die Anfrage ist fehlgeschlagen.");
  return data;
}
export function useAction() {
  const client = useQueryClient();
  return useMutation({
    // "message" benennt die Aenderung konkret; ohne Angabe bleibt es beim
    // allgemeinen Hinweis.
    mutationFn: ({ url, method = "POST", data }: { url: string; method?: string; data?: unknown; message?: string }) => json(url, { method, headers: { "Content-Type": "application/json" }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }),
    onSuccess: (_result, variables) => { toast.success(variables.message ?? "Gespeichert"); client.invalidateQueries(); },
    onError: (error: Error) => toast.error(error.message),
  });
}
export function ErrorMessage({ error }: { error: Error | null }) {
  return error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error.message}</p> : null;
}
export function dateLabel(date: string) { return new Date(date.slice(0,10) + "T12:00:00Z").toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit" }); }
export const selectClass = "h-10 w-full rounded-[var(--radius)] border border-input bg-card px-3 text-sm";
