import { api, ApiError } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { monthlyReport, reportPeriod } from "@/lib/report";

function cell(value: string | number) {
  const safe = String(value).replace(/^[=+@\-\t\r]/, "'$&");
  return '"' + safe.replaceAll('"', '""') + '"';
}

/** CSV mit genau den Zeilen und Werten, die die Auswertung auch anzeigt. */
export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { month, year, branchId } = reportPeriod(request);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError("Ungültiger Monat.");
    const report = await monthlyReport(a, month, year, { branchId });
    const headers = ["Nachname", "Vorname", "Sollstunden", "Geplante Stunden", "Iststunden", "Abweichung Ist/Plan", "Schichten"];
    const hours = (minutes: number | null) => minutes === null ? "–" : (minutes / 60).toFixed(2).replace(".", ",");
    const rows = report.employees.map((e) => [e.lastName, e.firstName, hours(e.targetMinutes), hours(e.plannedMinutes), hours(e.totalMinutes), hours(e.deviationMinutes), e.shiftCount]);
    return new Response("﻿" + [headers, ...rows].map((row) => row.map(cell).join(";")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="Stunden_' + year + "-" + month + '.csv"' } });
  });
}
