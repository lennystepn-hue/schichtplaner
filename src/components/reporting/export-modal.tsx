"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
// standort: Export auf einen Standort beschraenken (der Server prueft das Recht).
interface Props { open: boolean; onOpenChange: (open: boolean) => void; defaultMonth: number; defaultYear: number; standort?: string | null }
export function ExportModal(props: Props) {
  return props.open ? <ExportForm key={props.defaultYear + "-" + props.defaultMonth} {...props} /> : null;
}
function ExportForm({ open, onOpenChange, defaultMonth, defaultYear, standort }: Props) {
  const [period, setPeriod] = useState(defaultYear + "-" + String(defaultMonth).padStart(2, "0"));
  const [pending, setPending] = useState(false);
  async function download() {
    setPending(true);
    try {
      const [year, month] = period.split("-");
      const res = await fetch("/api/reporting/export?month=" + Number(month) + "&year=" + year + (standort ? "&standort=" + encodeURIComponent(standort) : ""));
      if (!res.ok) throw new Error((await res.json()).error || "Export fehlgeschlagen.");
      const url = URL.createObjectURL(await res.blob()), link = document.createElement("a");
      link.href = url; link.download = "AKRO-Stunden-" + period + ".csv"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onOpenChange(false);
      toast.success("CSV heruntergeladen.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Export fehlgeschlagen."); }
    finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Stunden exportieren</DialogTitle><DialogDescription>CSV mit Soll-, Plan- und Ist-Stunden{standort ? " für den gewählten Standort" : ""} – nur Personen und Zeiten, die du sehen darfst. Kann direkt in Excel geöffnet werden.</DialogDescription></DialogHeader><Label htmlFor="export-month">Monat</Label><Input id="export-month" type="month" value={period} onChange={e => setPeriod(e.target.value)} /><Button disabled={!period || pending} onClick={download}>{pending ? "Wird erstellt …" : "CSV herunterladen"}</Button></DialogContent></Dialog>;
}
