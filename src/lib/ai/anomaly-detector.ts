/**
 * AI Anomaly Detector
 *
 * Detects anomalies in time records for a given organization and month.
 * Checks for: long shifts, gaps, overlaps, and soll/ist deviation.
 */

import { db } from "@/lib/db";
import {
  startOfMonth,
  endOfMonth,
  parse,
  eachDayOfInterval,
  format,
  getDay,
  getISOWeek,
} from "date-fns";

// ─── Types ──────────────────────────────────────────────────────────

export type AnomalyType = "long_shift" | "gap" | "overlap" | "deviation";
export type AnomalySeverity = "warning" | "critical";

export interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  employeeId: string;
  employeeName: string;
  date: string;
  details: string;
  /** Relevant numeric value (hours, percentage, etc.) */
  value: number;
}

// ─── Configuration ──────────────────────────────────────────────────

const LONG_SHIFT_THRESHOLD_HOURS = 10;
/** Deviation threshold: if actual differs from scheduled by more than this %, flag it */
const DEVIATION_THRESHOLD_PERCENT = 25;

// ─── Helpers ────────────────────────────────────────────────────────

/** Compute duration in decimal hours from two HH:mm strings. */
function computeHoursFromRange(from: string, to: string): number {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  let totalMinutes = th * 60 + tm - (fh * 60 + fm);
  if (totalMinutes < 0) totalMinutes += 24 * 60; // overnight
  return totalMinutes / 60;
}

/** Convert HH:mm to minutes since midnight. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Check if two time ranges overlap. */
function timesOverlap(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string
): boolean {
  const aStart = toMinutes(aFrom);
  let aEnd = toMinutes(aTo);
  const bStart = toMinutes(bFrom);
  let bEnd = toMinutes(bTo);

  if (aEnd <= aStart) aEnd += 24 * 60;
  if (bEnd <= bStart) bEnd += 24 * 60;

  return aStart < bEnd && bStart < aEnd;
}

/** Get the Monday of an ISO week. */
function getWeekStartDate(weekNumber: number, year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1);
  monday.setDate(monday.getDate() + (weekNumber - 1) * 7);
  return monday;
}

// ─── Main function ──────────────────────────────────────────────────

/**
 * Detect anomalies in time records for a given month.
 *
 * @param orgId  Organization ID
 * @param month  Month string in "yyyy-MM" format (e.g. "2026-03")
 */
export async function detectAnomalies(
  orgId: string,
  month: string
): Promise<Anomaly[]> {
  const parsedMonth = parse(month, "yyyy-MM", new Date());
  if (isNaN(parsedMonth.getTime())) {
    throw new Error("Invalid month format. Use yyyy-MM");
  }

  const monthStart = startOfMonth(parsedMonth);
  const monthEnd = endOfMonth(parsedMonth);

  const anomalies: Anomaly[] = [];

  // 1. Get all active org members
  const members = await db.organizationMember.findMany({
    where: { organizationId: orgId, isActive: true },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  const userIds = members.map((m) => m.user.id);
  const userNameMap = new Map(
    members.map((m) => [
      m.user.id,
      `${m.user.firstName} ${m.user.lastName}`,
    ])
  );

  // 2. Get all time records for the month
  const timeRecords = await db.timeRecord.findMany({
    where: {
      userId: { in: userIds },
      date: { gte: monthStart, lte: monthEnd },
    },
    orderBy: [{ userId: "asc" }, { date: "asc" }, { timeFrom: "asc" }],
  });

  // Group time records by userId + date
  const recordsByUserDate = new Map<string, typeof timeRecords>();
  for (const record of timeRecords) {
    const dateStr = format(record.date, "yyyy-MM-dd");
    const key = `${record.userId}__${dateStr}`;
    const existing = recordsByUserDate.get(key) ?? [];
    existing.push(record);
    recordsByUserDate.set(key, existing);
  }

  // 3. Check for LONG SHIFTS
  for (const record of timeRecords) {
    if (!record.timeFrom || !record.timeTo) continue;
    const hours = computeHoursFromRange(record.timeFrom, record.timeTo);
    if (hours > LONG_SHIFT_THRESHOLD_HOURS) {
      const dateStr = format(record.date, "yyyy-MM-dd");
      anomalies.push({
        type: "long_shift",
        severity: hours > 12 ? "critical" : "warning",
        employeeId: record.userId,
        employeeName: userNameMap.get(record.userId) ?? "Unbekannt",
        date: dateStr,
        details: `Schicht dauert ${hours.toFixed(1)}h (${record.timeFrom} - ${record.timeTo}), Limit: ${LONG_SHIFT_THRESHOLD_HOURS}h`,
        value: Math.round(hours * 10) / 10,
      });
    }
  }

  // 4. Check for OVERLAPS (same user, same day, overlapping times)
  for (const [key, records] of recordsByUserDate) {
    if (records.length < 2) continue;

    const [userId] = key.split("__");
    const dateStr = key.split("__")[1];

    // Compare all pairs
    for (let i = 0; i < records.length; i++) {
      for (let j = i + 1; j < records.length; j++) {
        const a = records[i];
        const b = records[j];
        if (!a.timeFrom || !a.timeTo || !b.timeFrom || !b.timeTo) continue;

        if (timesOverlap(a.timeFrom, a.timeTo, b.timeFrom, b.timeTo)) {
          anomalies.push({
            type: "overlap",
            severity: "critical",
            employeeId: userId,
            employeeName: userNameMap.get(userId) ?? "Unbekannt",
            date: dateStr,
            details: `Ueberlappung: ${a.timeFrom}-${a.timeTo} und ${b.timeFrom}-${b.timeTo}`,
            value: 0,
          });
        }
      }
    }
  }

  // 5. Check for GAPS: active employees with missing records on scheduled days
  //    We need to find which days each employee was scheduled (has bookings)

  // Get all schedules that overlap with this month
  const year = parsedMonth.getFullYear();
  const monthNum = parsedMonth.getMonth(); // 0-based

  // Get all bookings for org members during this month
  const bookings = await db.booking.findMany({
    where: {
      userId: { in: userIds },
      shift: {
        deletedAt: null,
        schedule: {
          organizationId: orgId,
          year,
          deletedAt: null,
        },
      },
    },
    include: {
      shift: {
        select: {
          dayOfWeek: true,
          shiftFrom: true,
          shiftTo: true,
          schedule: {
            select: { weekNumber: true, year: true },
          },
        },
      },
    },
  });

  // Build a set of (userId, dateStr) for scheduled days
  const scheduledDays = new Map<string, { from: string; to: string }[]>();

  for (const booking of bookings) {
    const { weekNumber, year: schedYear } = booking.shift.schedule;
    const weekStart = getWeekStartDate(weekNumber, schedYear);
    const shiftDate = new Date(weekStart);
    shiftDate.setDate(shiftDate.getDate() + (booking.shift.dayOfWeek - 1));

    // Check if the date falls within our target month
    if (shiftDate < monthStart || shiftDate > monthEnd) continue;

    const dateStr = format(shiftDate, "yyyy-MM-dd");
    const key = `${booking.userId}__${dateStr}`;
    const existing = scheduledDays.get(key) ?? [];
    existing.push({
      from: booking.shift.shiftFrom,
      to: booking.shift.shiftTo,
    });
    scheduledDays.set(key, existing);
  }

  // Check: for each scheduled day, does the employee have a time record?
  // Only flag days that are in the past (not future)
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  for (const [key, shifts] of scheduledDays) {
    const [userId, dateStr] = key.split("__");
    const dayDate = new Date(dateStr + "T12:00:00");

    // Skip future dates
    if (dayDate > today) continue;

    // Check if there's a time record for this day
    const hasRecord = recordsByUserDate.has(key);

    if (!hasRecord) {
      const totalScheduled = shifts.reduce(
        (sum, s) => sum + computeHoursFromRange(s.from, s.to),
        0
      );
      anomalies.push({
        type: "gap",
        severity: "warning",
        employeeId: userId,
        employeeName: userNameMap.get(userId) ?? "Unbekannt",
        date: dateStr,
        details: `Eingeplant (${totalScheduled.toFixed(1)}h), aber keine Zeiterfassung vorhanden`,
        value: Math.round(totalScheduled * 10) / 10,
      });
    }
  }

  // 6. Check for SOLL/IST DEVIATION
  //    Compare scheduled hours vs actual recorded hours per employee per week
  //    Group scheduled and actual hours by user + ISO week

  const scheduledHoursPerWeek = new Map<string, number>();
  const actualHoursPerWeek = new Map<string, number>();

  // Scheduled hours
  for (const booking of bookings) {
    const { weekNumber, year: schedYear } = booking.shift.schedule;
    const weekStart = getWeekStartDate(weekNumber, schedYear);
    const shiftDate = new Date(weekStart);
    shiftDate.setDate(shiftDate.getDate() + (booking.shift.dayOfWeek - 1));
    if (shiftDate < monthStart || shiftDate > monthEnd) continue;

    const weekKey = `${booking.userId}__KW${weekNumber}`;
    const hours = computeHoursFromRange(
      booking.shift.shiftFrom,
      booking.shift.shiftTo
    );
    scheduledHoursPerWeek.set(
      weekKey,
      (scheduledHoursPerWeek.get(weekKey) ?? 0) + hours
    );
  }

  // Actual hours from time records
  for (const record of timeRecords) {
    const weekNum = getISOWeek(record.date);
    const weekKey = `${record.userId}__KW${weekNum}`;

    let hours = 0;
    if (
      (record.type === "MANUAL" || record.type === "WATCH") &&
      record.timeFrom &&
      record.timeTo
    ) {
      hours = computeHoursFromRange(record.timeFrom, record.timeTo);
    } else if (record.type === "MANUAL_DURATION") {
      hours =
        (record.durationHours ?? 0) + (record.durationMinutes ?? 0) / 60;
    }

    actualHoursPerWeek.set(
      weekKey,
      (actualHoursPerWeek.get(weekKey) ?? 0) + hours
    );
  }

  // Compare and detect deviations
  const processedWeeks = new Set<string>();
  for (const key of [
    ...scheduledHoursPerWeek.keys(),
    ...actualHoursPerWeek.keys(),
  ]) {
    if (processedWeeks.has(key)) continue;
    processedWeeks.add(key);

    const [userId, weekLabel] = key.split("__");
    const scheduled = scheduledHoursPerWeek.get(key) ?? 0;
    const actual = actualHoursPerWeek.get(key) ?? 0;

    // Only check if there are scheduled hours (otherwise gap detection handles it)
    if (scheduled === 0) continue;

    const deviationPercent = Math.abs(
      ((actual - scheduled) / scheduled) * 100
    );

    if (deviationPercent > DEVIATION_THRESHOLD_PERCENT && scheduled >= 2) {
      const isOver = actual > scheduled;
      anomalies.push({
        type: "deviation",
        severity: deviationPercent > 50 ? "critical" : "warning",
        employeeId: userId,
        employeeName: userNameMap.get(userId) ?? "Unbekannt",
        date: weekLabel,
        details: `${weekLabel}: Soll ${scheduled.toFixed(1)}h, Ist ${actual.toFixed(1)}h (${isOver ? "+" : "-"}${deviationPercent.toFixed(0)}%)`,
        value: Math.round(deviationPercent),
      });
    }
  }

  // Sort: critical first, then by date
  anomalies.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === "critical" ? -1 : 1;
    }
    return a.date.localeCompare(b.date);
  });

  return anomalies;
}
