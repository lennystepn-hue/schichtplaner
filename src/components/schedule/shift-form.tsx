"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { json, useAction, selectClass, ErrorMessage } from "@/components/workforce/client";
import type { ShiftData, DivisionOption } from "@/types/schedule";

type Props = { open: boolean; onOpenChange: (value: boolean) => void; scheduleId: string; branchId: string | null; defaultDayOfWeek?: number; shift?: ShiftData | null };
type BranchOption = { id: string; name: string; isActive: boolean; positions: string[]; customerId: string | null; customer: { name: string } | null };

export function ShiftForm(props: Props) { return props.open ? <Editor key={props.shift?.id || "new"} {...props} /> : null; }

function Editor({ open, onOpenChange, scheduleId, branchId, defaultDayOfWeek = 1, shift }: Props) {
  const action = useAction(), [days, setDays] = useState([shift?.dayOfWeek || defaultDayOfWeek]);
  const [copyDate, setCopyDate] = useState("");
  // Nur Standorte, an denen die angemeldete Person planen darf.
  const locations = useQuery({ queryKey: ["branches", "EDIT_SHIFTS"], queryFn: () => json<{ branches: BranchOption[] }>("/api/branches?right=EDIT_SHIFTS") });
  const divisions = useQuery({ queryKey: ["divisions"], queryFn: () => json<{ divisions: DivisionOption[] }>("/api/divisions") });
  const current = shift?.branchId ?? branchId;
  const plannable = (locations.data?.branches ?? []).filter((b) => (b.isActive && b.customerId) || b.id === current);
  const currentBranch = locations.data?.branches.find((b) => b.id === current);
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-[30rem]"><SheetHeader className="p-0 pb-4"><SheetTitle>{shift ? "Schicht bearbeiten" : "Schicht erstellen"}</SheetTitle><SheetDescription>Bei einer Endzeit vor der Startzeit endet die Schicht am Folgetag.</SheetDescription></SheetHeader><ErrorMessage error={locations.error || divisions.error} />
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const common = { divisionId: f.get("divisionId") || null, title: f.get("title") || null, shiftFrom: f.get("shiftFrom"), shiftTo: f.get("shiftTo"), maxEmployees: Number(f.get("maxEmployees")), pauseOption: f.get("pauseOption"), pauseValue: Number(f.get("pauseValue")), description: f.get("description") || null, requiredQualifications: String(f.get("qualifications")).split(",").map(s => s.trim()).filter(Boolean) };
      const data = shift
        ? { ...common, dayOfWeek: days[0], ...(f.get("branchId") && f.get("branchId") !== shift.branchId ? { branchId: f.get("branchId") } : {}) }
        : { ...common, scheduleId, dayOfWeek: days[0], repeatDays: days, repeatWeeks: Number(f.get("repeatWeeks") || 1) };
      await action.mutateAsync({ url: shift ? "/api/shifts/" + shift.id : "/api/shifts", method: shift ? "PATCH" : "POST", data, message: shift ? "Schicht geändert" : "Schicht angelegt" }).then(() => onOpenChange(false)).catch(() => {});
    }}>
      <label>Beginn<Input type="time" name="shiftFrom" defaultValue={shift?.shiftFrom || "08:00"} required /></label><label>Ende<Input type="time" name="shiftTo" defaultValue={shift?.shiftTo || "17:00"} required /></label>
      {shift ? (
        <label>Einsatzort<select name="branchId" defaultValue={shift.branchId || ""} className={selectClass} required={!shift.branchId}>
          {!shift.branchId && <option value="">Bitte zuordnen</option>}
          {plannable.map(b => <option key={b.id} value={b.id}>{b.name}{b.customer ? " · " + b.customer.name : ""}</option>)}
        </select></label>
      ) : (
        <div className="text-sm"><span className="block">Einsatzort</span><span className="flex h-10 items-center text-muted-foreground">{currentBranch ? currentBranch.name + (currentBranch.customer ? " · " + currentBranch.customer.name : "") : "Standort des Plans"}</span></div>
      )}
      <label>Arbeitsbereich<select name="divisionId" defaultValue={shift?.divisionId || ""} className={selectClass}><option value="">Kein Arbeitsbereich</option>{divisions.data?.divisions.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
      <label>Tätigkeit / Titel<Input name="title" list="shift-positions" defaultValue={shift?.title || ""} maxLength={100} /><datalist id="shift-positions">{[...new Set(currentBranch?.positions ?? [])].map(p => <option key={p} value={p} />)}</datalist></label>
      <label>Benötigte Mitarbeitende<Input name="maxEmployees" type="number" min={1} max={100} defaultValue={shift?.maxEmployees || 1} required /></label>
      <label>Pause in Minuten<Input name="pauseValue" type="number" min={0} max={120} defaultValue={shift?.pauseValue || 0} required /></label><label>Pausenregel<select name="pauseOption" className={selectClass} defaultValue={shift?.pauseOption || "PER_SHIFT"}><option value="PER_SHIFT">Pro Schicht</option><option value="PER_HOUR">Pro Stunde</option></select></label>
      <fieldset className="sm:col-span-2"><legend className="mb-2">{shift ? "Wochentag" : "Wochentage"}</legend><div className="flex flex-wrap gap-2">{["Mo","Di","Mi","Do","Fr","Sa","So"].map((name,i) => <Button type="button" key={name} variant={days.includes(i+1) ? "default" : "outline"} aria-pressed={days.includes(i+1)} onClick={() => setDays(old => shift ? [i+1] : old.includes(i+1) ? old.length > 1 ? old.filter(d => d !== i+1) : old : [...old,i+1])}>{name}</Button>)}</div></fieldset>
      {!shift && <label>Wöchentlich wiederholen (Wochen)<Input name="repeatWeeks" type="number" min={1} max={52} defaultValue={1} required /></label>}
      <label className="sm:col-span-2">Erforderliche Qualifikationen (Komma getrennt)<Input name="qualifications" defaultValue={shift?.requiredQualifications?.join(", ") || ""} /></label>
      <label className="sm:col-span-2">Hinweise<Textarea name="description" defaultValue={shift?.description || ""} maxLength={2000} /></label>
      <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">{shift && <ConfirmDialog title="Schicht absagen" description="Die Schicht wird gelöscht und alle Zuweisungen werden aufgehoben. Betroffene Mitarbeitende verlieren diesen Einsatz." confirmLabel="Schicht löschen" disabled={action.isPending} onConfirm={() => { action.mutateAsync({ url: "/api/shifts/" + shift.id, method: "DELETE", message: "Schicht abgesagt" }).then(() => onOpenChange(false)).catch(() => {}); }}><Button type="button" variant="destructive" disabled={action.isPending}>Schicht löschen</Button></ConfirmDialog>}<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button><Button disabled={action.isPending}>Speichern</Button></div>
    </form>
    {shift && shift.branchId && <div className="border-t pt-4 flex flex-wrap items-end gap-3"><label className="flex-1">Schicht kopieren auf<Input type="date" value={copyDate} onChange={e => setCopyDate(e.target.value)} /></label><Button variant="outline" disabled={!copyDate || action.isPending} onClick={() => action.mutateAsync({ url: "/api/shifts/" + shift.id + "/copy", data: { date: copyDate }, message: "Schicht kopiert" }).then(() => onOpenChange(false)).catch(() => {})}>Kopieren</Button><p className="text-xs text-muted-foreground w-full">Details werden an denselben Standort kopiert. Mitarbeitende weist du anschließend zu.</p></div>}
  </SheetContent></Sheet>;
}
