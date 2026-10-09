/** Local calendar dates are stored as UTC date-only values; instants stay UTC. */
export const TIME_ZONE = "Europe/Berlin";
export function berlinDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function berlinTime(now = new Date()): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}
export function addDate(date: string, days: number): string {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function weekDate(year: number, week: number, day = 1): string {
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7 + day - 1);
  return jan4.toISOString().slice(0, 10);
}
export function isoWeek(date: string): { year: number; weekNumber: number } {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() + 6) % 7);
  const year = d.getUTCFullYear();
  return { year, weekNumber: 1 + Math.round((d.getTime() - new Date(weekDate(year, 1, 4) + "T12:00:00Z").getTime()) / 604800000) };
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function minuteOfDay(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function rangeMinutes(from: string, to: string): number {
  const minutes = minuteOfDay(to) - minuteOfDay(from);
  return minutes < 0 ? minutes + 1440 : minutes;
}
export function shiftRange(shift: { dayOfWeek: number; shiftFrom: string; shiftTo: string; schedule: { year: number; weekNumber: number } }) {
  const date = weekDate(shift.schedule.year, shift.schedule.weekNumber, shift.dayOfWeek);
  const start = Date.parse(date + "T00:00:00Z") / 60000 + minuteOfDay(shift.shiftFrom);
  return { date, start, end: start + rangeMinutes(shift.shiftFrom, shift.shiftTo) };
}
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}
export function recordMinutes(record: { startedAt?: Date | string | null; endedAt?: Date | string | null; timeFrom: string | null; timeTo: string | null; type: string; durationHours: number | null; durationMinutes: number | null; breakSeconds?: number }): number {
  const gross = record.startedAt && record.endedAt ? (new Date(record.endedAt).getTime() - new Date(record.startedAt).getTime()) / 60000 : record.type === "MANUAL_DURATION" ? (record.durationHours ?? 0) * 60 + (record.durationMinutes ?? 0) : record.timeFrom && record.timeTo ? rangeMinutes(record.timeFrom, record.timeTo) : 0;
  return Math.max(0, Math.round(gross - (record.breakSeconds ?? 0) / 60));
}
