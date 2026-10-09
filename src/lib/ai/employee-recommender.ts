/**
 * AI Employee Recommender
 *
 * Rule-based scoring system (no LLM needed) that ranks employees
 * for a given shift based on hours balance, availability, division
 * match, and historical preference.
 */

import { db } from "@/lib/db";

// ─── Types ──────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  /** 0-40: employees with fewer hours this week score higher */
  hours: number;
  /** 0-30: no absence, no overlapping shift = full points */
  availability: number;
  /** 0-20: employee belongs to the shift's division */
  division: number;
  /** 0-10: employee has worked this time slot in the last 4 weeks */
  history: number;
}

export interface EmployeeScore {
  employeeId: string;
  firstName: string;
  lastName: string;
  score: number;
  breakdown: ScoreBreakdown;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Estimate hours between two HH:mm strings. */
function estimateHours(from: string, to: string): number {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  let diff = th * 60 + tm - (fh * 60 + fm);
  if (diff < 0) diff += 24 * 60; // overnight
  return diff / 60;
}

/** Check if two time ranges overlap (HH:mm format). */
function timesOverlap(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string
): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const aStart = toMin(aFrom);
  let aEnd = toMin(aTo);
  const bStart = toMin(bFrom);
  let bEnd = toMin(bTo);

  // Handle overnight shifts
  if (aEnd <= aStart) aEnd += 24 * 60;
  if (bEnd <= bStart) bEnd += 24 * 60;

  return aStart < bEnd && bStart < aEnd;
}

/** Get the Monday of an ISO week as a Date. */
function getWeekStartDate(weekNumber: number, year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1);
  monday.setDate(monday.getDate() + (weekNumber - 1) * 7);
  return monday;
}

// ─── Main scoring function ──────────────────────────────────────────

/**
 * Get scored employee list for a given shift.
 * Returns employees sorted by score descending.
 */
export async function getEmployeeScores(
  shiftId: string,
  orgId: string
): Promise<EmployeeScore[]> {
  // 1. Get the shift with its schedule and division
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    include: {
      schedule: { select: { weekNumber: true, year: true } },
      division: { select: { id: true, title: true } },
      bookings: { select: { userId: true } },
    },
  });

  if (!shift || !shift.schedule) {
    return [];
  }

  const { weekNumber, year } = shift.schedule;
  const weekStart = getWeekStartDate(weekNumber, year);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  // 2. Get all active org employees
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

  // Exclude already booked users
  const bookedUserIds = new Set(shift.bookings.map((b) => b.userId));

  // Filter to candidates (not already booked)
  const candidates = members.filter((m) => !bookedUserIds.has(m.user.id));

  if (candidates.length === 0) {
    return [];
  }

  const candidateUserIds = candidates.map((c) => c.user.id);

  // 3. Get division memberships
  const divisionMembers = shift.divisionId
    ? await db.divisionMember.findMany({
        where: {
          divisionId: shift.divisionId,
          userId: { in: candidateUserIds },
        },
      })
    : [];
  const divisionUserIds = new Set(divisionMembers.map((dm) => dm.userId));

  // 4. Get absences overlapping the shift's day
  //    Convert dayOfWeek (1=Mon..7=Sun) to actual date
  const shiftDate = new Date(weekStart);
  shiftDate.setDate(shiftDate.getDate() + (shift.dayOfWeek - 1));

  const absences = await db.absence.findMany({
    where: {
      userId: { in: candidateUserIds },
      status: { in: ["APPROVED", "PENDING"] },
      dateFrom: { lte: shiftDate },
      dateTo: { gte: shiftDate },
    },
    select: { userId: true },
  });
  const absentUserIds = new Set(absences.map((a) => a.userId));

  // 5. Get all bookings for this week to calculate hours + detect overlaps
  const weekBookings = await db.booking.findMany({
    where: {
      userId: { in: candidateUserIds },
      shift: {
        schedule: {
          organizationId: orgId,
          weekNumber,
          year,
        },
        deletedAt: null,
      },
    },
    include: {
      shift: {
        select: {
          dayOfWeek: true,
          shiftFrom: true,
          shiftTo: true,
        },
      },
    },
  });

  // Build per-user hours this week and collect same-day shifts
  const weekHoursMap = new Map<string, number>();
  const userDayShifts = new Map<string, { from: string; to: string }[]>();

  for (const b of weekBookings) {
    const hours = estimateHours(b.shift.shiftFrom, b.shift.shiftTo);
    weekHoursMap.set(b.userId, (weekHoursMap.get(b.userId) ?? 0) + hours);

    // Track same-day shifts for overlap detection
    if (b.shift.dayOfWeek === shift.dayOfWeek) {
      const key = b.userId;
      const existing = userDayShifts.get(key) ?? [];
      existing.push({ from: b.shift.shiftFrom, to: b.shift.shiftTo });
      userDayShifts.set(key, existing);
    }
  }

  // 6. Historical preference: check last 4 weeks for same time slot
  const prevWeeks: { weekNumber: number; year: number }[] = [];
  for (let i = 1; i <= 4; i++) {
    let pw = weekNumber - i;
    let py = year;
    if (pw < 1) {
      pw += 52;
      py--;
    }
    prevWeeks.push({ weekNumber: pw, year: py });
  }

  const historicalBookings = await db.booking.findMany({
    where: {
      userId: { in: candidateUserIds },
      shift: {
        dayOfWeek: shift.dayOfWeek,
        shiftFrom: shift.shiftFrom,
        shiftTo: shift.shiftTo,
        deletedAt: null,
        schedule: {
          organizationId: orgId,
          OR: prevWeeks.map((pw) => ({
            weekNumber: pw.weekNumber,
            year: pw.year,
          })),
        },
      },
    },
    select: { userId: true },
  });

  // Count how many of the 4 weeks each user worked this slot
  const historyCountMap = new Map<string, number>();
  for (const hb of historicalBookings) {
    historyCountMap.set(
      hb.userId,
      (historyCountMap.get(hb.userId) ?? 0) + 1
    );
  }

  // 7. Compute max hours across candidates for relative scoring
  const allHours = candidateUserIds.map(
    (uid) => weekHoursMap.get(uid) ?? 0
  );
  const maxHoursThisWeek = Math.max(...allHours, 1); // avoid division by zero

  // 8. Score each candidate
  const scores: EmployeeScore[] = [];

  for (const candidate of candidates) {
    const userId = candidate.user.id;

    // --- Hours balance (max 40 pts) ---
    // Employees with fewer hours score higher
    const userHours = weekHoursMap.get(userId) ?? 0;
    const hoursRatio = maxHoursThisWeek > 0 ? userHours / maxHoursThisWeek : 0;
    const hoursScore = Math.round(40 * (1 - hoursRatio));

    // --- Availability (max 30 pts) ---
    let availabilityScore = 30;
    // Check if absent
    if (absentUserIds.has(userId)) {
      availabilityScore = 0;
    } else {
      // Check for overlapping shifts on the same day
      const sameDayShifts = userDayShifts.get(userId) ?? [];
      const hasOverlap = sameDayShifts.some((s) =>
        timesOverlap(s.from, s.to, shift.shiftFrom, shift.shiftTo)
      );
      if (hasOverlap) {
        availabilityScore = 0;
      }
    }

    // --- Division match (max 20 pts) ---
    let divisionScore = 0;
    if (!shift.divisionId) {
      // No division required, give partial points
      divisionScore = 10;
    } else if (divisionUserIds.has(userId)) {
      divisionScore = 20;
    }

    // --- Historical preference (max 10 pts) ---
    const histCount = historyCountMap.get(userId) ?? 0;
    // 4 weeks = 10 pts, 3 = 7.5, 2 = 5, 1 = 2.5, 0 = 0
    const historyScore = Math.round((histCount / 4) * 10);

    const totalScore =
      hoursScore + availabilityScore + divisionScore + historyScore;

    scores.push({
      employeeId: userId,
      firstName: candidate.user.firstName,
      lastName: candidate.user.lastName,
      score: totalScore,
      breakdown: {
        hours: hoursScore,
        availability: availabilityScore,
        division: divisionScore,
        history: historyScore,
      },
    });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  return scores;
}
