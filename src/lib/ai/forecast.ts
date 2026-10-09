/**
 * AI Forecast Logic
 *
 * Collects historical hours data, calculates moving averages,
 * performs simple linear regression for trend, and returns
 * data points + forecast for visualization.
 */

import { db } from "@/lib/db";
import { generateAIResponse } from "./client";

// ─── Types ──────────────────────────────────────────────────────────

export interface WeeklyDataPoint {
  weekNumber: number;
  year: number;
  /** Label like "KW 10" */
  label: string;
  /** Actual total hours booked that week. */
  actualHours: number;
  /** Number of active employees with bookings. */
  employeeCount: number;
  /** Number of shifts that week. */
  shiftCount: number;
  /** Whether this is a forecast (not actual data). */
  isForecast: boolean;
  /** Moving average (4-week window). Only set if enough data. */
  movingAvg?: number;
  /** Forecast value (from linear regression). */
  forecastHours?: number;
}

export interface ForecastResult {
  dataPoints: WeeklyDataPoint[];
  trend: "up" | "down" | "stable";
  trendPercent: number;
  avgHoursPerWeek: number;
  totalEmployees: number;
  /** Optional Claude-generated natural-language summary. */
  summary?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Get the Monday of an ISO week. */
function getWeekStartDate(weekNumber: number, year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1);
  monday.setDate(monday.getDate() + (weekNumber - 1) * 7);
  return monday;
}

/** Estimate hours between two HH:mm strings. */
function estimateHours(from: string, to: string): number {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  let diff = th * 60 + tm - (fh * 60 + fm);
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

/** Get current ISO week number. */
function getCurrentISOWeek(): { weekNumber: number; year: number } {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1);

  const diff = now.getTime() - monday.getTime();
  const weekNumber = Math.ceil((diff / (7 * 24 * 60 * 60 * 1000)) + 1);

  // Handle year boundaries
  if (weekNumber < 1) {
    return { weekNumber: 52, year: now.getFullYear() - 1 };
  }
  if (weekNumber > 52) {
    return { weekNumber: 1, year: now.getFullYear() + 1 };
  }

  return { weekNumber, year: now.getFullYear() };
}

/** Linear regression on an array of (x, y) pairs. Returns slope and intercept. */
function linearRegression(
  points: Array<{ x: number; y: number }>
): { slope: number; intercept: number } {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: points[0].y };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

// ─── Main Function ──────────────────────────────────────────────────

/**
 * Generate a forecast for the given organization.
 *
 * Looks back 12 weeks, computes hours per week, fits a linear
 * regression, and projects 4 weeks into the future.
 */
export async function generateForecast(
  orgId: string,
  options?: { generateSummary?: boolean }
): Promise<ForecastResult> {
  const current = getCurrentISOWeek();
  const LOOKBACK_WEEKS = 12;
  const FORECAST_WEEKS = 4;

  // Build list of weeks to query (past 12 weeks)
  const weeks: Array<{ weekNumber: number; year: number }> = [];
  for (let i = LOOKBACK_WEEKS - 1; i >= 0; i--) {
    let wk = current.weekNumber - i;
    let yr = current.year;
    while (wk < 1) {
      wk += 52;
      yr--;
    }
    weeks.push({ weekNumber: wk, year: yr });
  }

  // Query all schedules for these weeks
  const schedules = await db.schedule.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      OR: weeks.map((w) => ({
        weekNumber: w.weekNumber,
        year: w.year,
      })),
    },
    include: {
      shifts: {
        where: { deletedAt: null },
        include: {
          bookings: { select: { userId: true } },
        },
      },
    },
  });

  // Build a map: "year-weekNumber" -> schedule
  const scheduleMap = new Map<string, (typeof schedules)[number]>();
  for (const s of schedules) {
    scheduleMap.set(`${s.year}-${s.weekNumber}`, s);
  }

  // Build data points for each historical week
  const dataPoints: WeeklyDataPoint[] = [];

  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const schedule = scheduleMap.get(`${w.year}-${w.weekNumber}`);

    let actualHours = 0;
    let shiftCount = 0;
    const employeeSet = new Set<string>();

    if (schedule) {
      shiftCount = schedule.shifts.length;
      for (const shift of schedule.shifts) {
        const hours = estimateHours(shift.shiftFrom, shift.shiftTo);
        for (const booking of shift.bookings) {
          actualHours += hours;
          employeeSet.add(booking.userId);
        }
      }
    }

    dataPoints.push({
      weekNumber: w.weekNumber,
      year: w.year,
      label: `KW ${w.weekNumber}`,
      actualHours: Math.round(actualHours * 10) / 10,
      employeeCount: employeeSet.size,
      shiftCount,
      isForecast: false,
    });
  }

  // Calculate moving averages (4-week window)
  for (let i = 3; i < dataPoints.length; i++) {
    const sum =
      dataPoints[i].actualHours +
      dataPoints[i - 1].actualHours +
      dataPoints[i - 2].actualHours +
      dataPoints[i - 3].actualHours;
    dataPoints[i].movingAvg = Math.round((sum / 4) * 10) / 10;
  }

  // Linear regression
  const regressionPoints = dataPoints.map((dp, idx) => ({
    x: idx,
    y: dp.actualHours,
  }));
  const { slope, intercept } = linearRegression(regressionPoints);

  // Add forecast data points
  for (let i = 1; i <= FORECAST_WEEKS; i++) {
    let fwk = current.weekNumber + i;
    let fyr = current.year;
    if (fwk > 52) {
      fwk -= 52;
      fyr++;
    }

    const forecastValue = Math.max(
      0,
      Math.round((intercept + slope * (LOOKBACK_WEEKS - 1 + i)) * 10) / 10
    );

    dataPoints.push({
      weekNumber: fwk,
      year: fyr,
      label: `KW ${fwk}`,
      actualHours: 0,
      employeeCount: 0,
      shiftCount: 0,
      isForecast: true,
      forecastHours: forecastValue,
    });
  }

  // Determine trend
  const avgHours =
    dataPoints.filter((d) => !d.isForecast).reduce((s, d) => s + d.actualHours, 0) /
    LOOKBACK_WEEKS;

  const lastForecast = dataPoints[dataPoints.length - 1].forecastHours ?? avgHours;
  const trendPercent =
    avgHours > 0
      ? Math.round(((lastForecast - avgHours) / avgHours) * 100)
      : 0;

  let trend: "up" | "down" | "stable" = "stable";
  if (trendPercent > 5) trend = "up";
  else if (trendPercent < -5) trend = "down";

  // Total active employees
  const totalEmployees = await db.organizationMember.count({
    where: { organizationId: orgId, isActive: true },
  });

  const result: ForecastResult = {
    dataPoints,
    trend,
    trendPercent,
    avgHoursPerWeek: Math.round(avgHours * 10) / 10,
    totalEmployees,
  };

  // Optional: generate Claude summary
  if (options?.generateSummary) {
    try {
      const summaryData = {
        historicalWeeks: dataPoints
          .filter((d) => !d.isForecast)
          .map((d) => ({
            week: d.label,
            hours: d.actualHours,
            employees: d.employeeCount,
          })),
        forecastWeeks: dataPoints
          .filter((d) => d.isForecast)
          .map((d) => ({
            week: d.label,
            forecastHours: d.forecastHours,
          })),
        trend,
        trendPercent,
        avgHoursPerWeek: result.avgHoursPerWeek,
        totalEmployees,
      };

      const aiResponse = await generateAIResponse({
        orgId,
        feature: "forecast",
        systemPrompt:
          "Du bist ein Analyst fuer Schichtplanung. Erstelle eine kurze, praegnante Zusammenfassung (3-5 Saetze) der Stunden-Trends und Prognose. Nenne konkrete Zahlen. Antworte auf Deutsch.",
        userMessage: `Analysiere diese Schichtplan-Daten:\n${JSON.stringify(summaryData, null, 2)}`,
        maxTokens: 500,
      });

      result.summary = aiResponse.content;
    } catch (error) {
      console.error("[Forecast] AI summary failed:", error);
      // Non-critical: just skip the summary
    }
  }

  return result;
}
