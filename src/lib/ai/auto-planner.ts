/**
 * AI Auto-Planner
 *
 * Gathers scheduling context (employees, shifts, absences, previous week)
 * and asks Claude for optimal shift assignment suggestions.
 */

import { db } from "@/lib/db";
import { generateAIResponse } from "./client";

// ─── Types ──────────────────────────────────────────────────────────

export interface ShiftSuggestion {
  shiftId: string;
  employeeId: string;
  /** Confidence / quality score 0-100. */
  score: number;
  /** Short human-readable reason. */
  reason: string;
}

// ─── Context gathering ──────────────────────────────────────────────

interface EmployeeContext {
  id: string;
  name: string;
  divisions: string[];
  hoursThisWeek: number;
  hoursThisMonth: number;
}

interface ShiftContext {
  id: string;
  dayOfWeek: number;
  from: string;
  to: string;
  division: string | null;
  maxEmployees: number;
  currentBookings: string[]; // employee ids already booked
}

interface AbsenceContext {
  employeeId: string;
  employeeName: string;
  from: string;
  to: string;
}

interface PlanningContext {
  employees: EmployeeContext[];
  shifts: ShiftContext[];
  absences: AbsenceContext[];
  previousWeekShifts: ShiftContext[];
}

async function gatherContext(
  scheduleId: string,
  orgId: string
): Promise<PlanningContext> {
  // 1. Get the schedule with its shifts
  const schedule = await db.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      shifts: {
        where: { deletedAt: null },
        include: {
          division: { select: { id: true, title: true } },
          bookings: { select: { userId: true } },
        },
      },
    },
  });

  if (!schedule) throw new Error("Schedule nicht gefunden");

  // 2. Get all active employees in the org with their divisions
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

  // 3. Get division memberships for all users
  const divisionMembers = await db.divisionMember.findMany({
    where: {
      division: { organizationId: orgId, deletedAt: null },
    },
    include: {
      division: { select: { id: true, title: true } },
    },
  });

  // Build a map userId -> division titles
  const userDivisions = new Map<string, string[]>();
  for (const dm of divisionMembers) {
    const existing = userDivisions.get(dm.userId) ?? [];
    existing.push(dm.division.title);
    userDivisions.set(dm.userId, existing);
  }

  // 4. Calculate hours worked this week (from time records)
  //    We approximate using the schedule's week dates
  const weekStart = getWeekStartDate(schedule.weekNumber, schedule.year);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const monthStart = new Date(schedule.year, weekStart.getMonth(), 1);
  const monthEnd = new Date(schedule.year, weekStart.getMonth() + 1, 0);

  // Get booked shifts for the week to estimate hours
  const userIds = members.map((m) => m.user.id);
  const weekBookings = await db.booking.findMany({
    where: {
      userId: { in: userIds },
      shift: {
        schedule: {
          organizationId: orgId,
          weekNumber: schedule.weekNumber,
          year: schedule.year,
        },
        deletedAt: null,
      },
    },
    include: {
      shift: { select: { shiftFrom: true, shiftTo: true } },
    },
  });

  // Monthly bookings for hour estimate
  const monthBookings = await db.booking.findMany({
    where: {
      userId: { in: userIds },
      shift: {
        schedule: {
          organizationId: orgId,
          year: schedule.year,
          deletedAt: null,
        },
        deletedAt: null,
      },
    },
    include: {
      shift: {
        select: {
          shiftFrom: true,
          shiftTo: true,
          schedule: { select: { weekNumber: true, year: true } },
        },
      },
    },
  });

  // Helper: estimate hours between two HH:mm strings
  function estimateHours(from: string, to: string): number {
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    let diff = th * 60 + tm - (fh * 60 + fm);
    if (diff < 0) diff += 24 * 60; // overnight
    return diff / 60;
  }

  // Build per-user hour maps
  const weekHoursMap = new Map<string, number>();
  for (const b of weekBookings) {
    const hours = estimateHours(b.shift.shiftFrom, b.shift.shiftTo);
    weekHoursMap.set(b.userId, (weekHoursMap.get(b.userId) ?? 0) + hours);
  }

  // For monthly, filter by the same month
  const targetMonth = weekStart.getMonth();
  const monthHoursMap = new Map<string, number>();
  for (const b of monthBookings) {
    // Rough check: is this booking's schedule in the target month?
    const bWeekStart = getWeekStartDate(
      b.shift.schedule.weekNumber,
      b.shift.schedule.year
    );
    if (bWeekStart.getMonth() === targetMonth) {
      const hours = estimateHours(b.shift.shiftFrom, b.shift.shiftTo);
      monthHoursMap.set(b.userId, (monthHoursMap.get(b.userId) ?? 0) + hours);
    }
  }

  const employees: EmployeeContext[] = members.map((m) => ({
    id: m.user.id,
    name: `${m.user.firstName} ${m.user.lastName}`,
    divisions: userDivisions.get(m.user.id) ?? [],
    hoursThisWeek: Math.round((weekHoursMap.get(m.user.id) ?? 0) * 10) / 10,
    hoursThisMonth: Math.round((monthHoursMap.get(m.user.id) ?? 0) * 10) / 10,
  }));

  // 5. Get absences for the week
  const absences = await db.absence.findMany({
    where: {
      user: {
        memberships: {
          some: { organizationId: orgId, isActive: true },
        },
      },
      status: { in: ["APPROVED", "PENDING"] },
      dateFrom: { lte: weekEnd },
      dateTo: { gte: weekStart },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const absenceContexts: AbsenceContext[] = absences.map((a) => ({
    employeeId: a.user.id,
    employeeName: `${a.user.firstName} ${a.user.lastName}`,
    from: a.dateFrom.toISOString().split("T")[0],
    to: a.dateTo.toISOString().split("T")[0],
  }));

  // 6. Current shifts
  const shiftContexts: ShiftContext[] = schedule.shifts.map((s) => ({
    id: s.id,
    dayOfWeek: s.dayOfWeek,
    from: s.shiftFrom,
    to: s.shiftTo,
    division: s.division?.title ?? null,
    maxEmployees: s.maxEmployees,
    currentBookings: s.bookings.map((b) => b.userId),
  }));

  // 7. Previous week's schedule for pattern detection
  let prevWeek = schedule.weekNumber - 1;
  let prevYear = schedule.year;
  if (prevWeek < 1) {
    prevWeek = 52;
    prevYear--;
  }

  const prevSchedule = await db.schedule.findFirst({
    where: {
      organizationId: orgId,
      weekNumber: prevWeek,
      year: prevYear,
      // Vorwoche desselben Standorts
      branchId: schedule.branchId,
      deletedAt: null,
    },
    include: {
      shifts: {
        where: { deletedAt: null },
        include: {
          division: { select: { title: true } },
          bookings: { select: { userId: true } },
        },
      },
    },
  });

  const previousWeekShifts: ShiftContext[] = (prevSchedule?.shifts ?? []).map(
    (s) => ({
      id: s.id,
      dayOfWeek: s.dayOfWeek,
      from: s.shiftFrom,
      to: s.shiftTo,
      division: s.division?.title ?? null,
      maxEmployees: s.maxEmployees,
      currentBookings: s.bookings.map((b) => b.userId),
    })
  );

  return {
    employees,
    shifts: shiftContexts,
    absences: absenceContexts,
    previousWeekShifts,
  };
}

/** Get the Monday of an ISO week as a Date. */
function getWeekStartDate(weekNumber: number, year: number): Date {
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // 1=Mon..7=Sun
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1); // Monday of week 1
  monday.setDate(monday.getDate() + (weekNumber - 1) * 7);
  return monday;
}

// ─── Prompt builder ─────────────────────────────────────────────────

function buildPrompt(ctx: PlanningContext): { system: string; user: string } {
  const system = `Du bist ein KI-Assistent fuer Schichtplanung. Deine Aufgabe ist es, optimale Schichtzuweisungen vorzuschlagen.

Regeln:
1. Mitarbeiter mit passender Bereichszuordnung (Division) werden bevorzugt.
2. Abwesende Mitarbeiter duerfen NICHT eingeplant werden.
3. Verteile Stunden moeglichst gleichmaessig auf alle Mitarbeiter.
4. Beruecksichtige die Vorwoche fuer Mustererkennung (z.B. regelmaessige Schichten).
5. Keine Doppelbuchungen: Ein Mitarbeiter kann nicht in zwei ueberlappende Schichten am selben Tag.
6. Bereits gebuchte Mitarbeiter nicht erneut vorschlagen.

Antworte AUSSCHLIESSLICH mit einem JSON-Array. Kein Markdown, kein erklarender Text.
Jedes Element hat diese Felder:
- shiftId: string (die Schicht-ID)
- employeeId: string (die Mitarbeiter-ID)
- score: number (0-100, wie gut die Zuweisung passt)
- reason: string (kurze Begruendung auf Deutsch, max 80 Zeichen)

Wenn eine Schicht bereits voll besetzt ist (currentBookings.length >= maxEmployees), ueberspringe sie.`;

  const user = `Hier sind die Daten fuer die Schichtplanung:

## Mitarbeiter
${JSON.stringify(ctx.employees, null, 2)}

## Offene Schichten (diese Woche)
${JSON.stringify(ctx.shifts, null, 2)}

## Abwesenheiten (diese Woche)
${JSON.stringify(ctx.absences, null, 2)}

## Vorwoche (Muster-Referenz)
${JSON.stringify(ctx.previousWeekShifts, null, 2)}

Erstelle optimale Schichtzuweisungen als JSON-Array.`;

  return { system, user };
}

// ─── Main function ──────────────────────────────────────────────────

/**
 * Generate AI-powered schedule suggestions for a given schedule.
 * Returns an array of shift assignment suggestions with confidence scores.
 */
export async function generateScheduleSuggestion(
  scheduleId: string,
  orgId: string
): Promise<ShiftSuggestion[]> {
  // 1. Gather all context
  const ctx = await gatherContext(scheduleId, orgId);

  // If there are no shifts or no employees, return empty
  if (ctx.shifts.length === 0 || ctx.employees.length === 0) {
    return [];
  }

  // Filter to shifts that actually have open slots
  const openShifts = ctx.shifts.filter(
    (s) => s.currentBookings.length < s.maxEmployees
  );

  if (openShifts.length === 0) {
    return [];
  }

  // Use only open shifts in the prompt
  const promptCtx = { ...ctx, shifts: openShifts };

  // 2. Build the prompt
  const { system, user } = buildPrompt(promptCtx);

  // 3. Call Claude
  const response = await generateAIResponse({
    orgId,
    feature: "autoPlanner",
    systemPrompt: system,
    userMessage: user,
    maxTokens: 4096,
  });

  // 4. Parse the JSON response
  const suggestions = parseAIResponse(response.content, ctx);

  return suggestions;
}

/**
 * Parse Claude's response into validated ShiftSuggestion array.
 * Handles edge cases like markdown code blocks, invalid JSON, etc.
 */
function parseAIResponse(
  content: string,
  ctx: PlanningContext
): ShiftSuggestion[] {
  // Strip markdown code blocks if present
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("[AI Auto-Planner] Failed to parse JSON:", content);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error("[AI Auto-Planner] Response is not an array:", parsed);
    return [];
  }

  // Build lookup sets for validation
  const validShiftIds = new Set(ctx.shifts.map((s) => s.id));
  const validEmployeeIds = new Set(ctx.employees.map((e) => e.id));
  const absentEmployeeIds = new Set(ctx.absences.map((a) => a.employeeId));

  const suggestions: ShiftSuggestion[] = [];

  for (const item of parsed) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.shiftId !== "string" ||
      typeof item.employeeId !== "string" ||
      typeof item.score !== "number" ||
      typeof item.reason !== "string"
    ) {
      continue; // Skip malformed entries
    }

    // Validate references exist
    if (!validShiftIds.has(item.shiftId)) continue;
    if (!validEmployeeIds.has(item.employeeId)) continue;

    // Don't suggest absent employees (double-check)
    if (absentEmployeeIds.has(item.employeeId)) continue;

    // Clamp score
    const score = Math.max(0, Math.min(100, Math.round(item.score)));

    suggestions.push({
      shiftId: item.shiftId,
      employeeId: item.employeeId,
      score,
      reason: String(item.reason).slice(0, 120),
    });
  }

  // Sort by score descending
  suggestions.sort((a, b) => b.score - a.score);

  return suggestions;
}
