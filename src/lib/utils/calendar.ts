import {
  startOfISOWeek,
  addDays,
  getISOWeek,
  getISOWeekYear,
  format,
} from "date-fns";
import { berlinDate } from "@/lib/berlin";

/**
 * Get the current ISO calendar week and year.
 */
export function getCurrentKW(): { weekNumber: number; year: number } {
  const now = new Date(berlinDate() + "T12:00:00");
  return { weekNumber: getISOWeek(now), year: getISOWeekYear(now) };
}

/**
 * Get all 7 dates (Mon-Sun) of a given ISO week.
 */
export function getWeekDates(weekNumber: number, year: number): Date[] {
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(year, 0, 4);
  const startOfWeek1 = startOfISOWeek(jan4);
  const targetDate = addDays(startOfWeek1, (weekNumber - 1) * 7);
  const weekStart = startOfISOWeek(targetDate);

  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * Format a week number + year as "09-2026".
 */
export function formatKW(weekNumber: number, year: number): string {
  return `${String(weekNumber).padStart(2, "0")}-${year}`;
}

/**
 * Parse a KW string like "09-2026" into { weekNumber, year }.
 * Returns null if the format is invalid.
 */
export function parseKW(
  kwString: string
): { weekNumber: number; year: number } | null {
  const match = kwString.match(/^(\d{1,2})-(\d{4})$/);
  if (!match) return null;
  const weekNumber = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);
  if (weekNumber < 1 || weekNumber > 53) return null;
  return { weekNumber, year };
}

/**
 * Get all ISO week numbers that overlap with a given month.
 */
export function getMonthKWs(
  month: number,
  year: number
): { weekNumber: number; year: number }[] {
  const kws: { weekNumber: number; year: number }[] = [];
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  let currentDate = firstDay;
  const seen = new Set<string>();

  while (currentDate <= lastDay) {
    const kw = getISOWeek(currentDate);
    const kwYear = getISOWeekYear(currentDate);
    const key = `${kw}-${kwYear}`;
    if (!seen.has(key)) {
      seen.add(key);
      kws.push({ weekNumber: kw, year: kwYear });
    }
    currentDate = addDays(currentDate, 1);
  }

  return kws;
}

/**
 * Format a date as "dd.MM" (e.g. "24.02").
 */
export function formatDateShort(date: Date): string {
  return format(date, "dd.MM");
}

/**
 * Format a date as "dd.MM.yyyy" (e.g. "24.02.2026").
 */
export function formatDateLong(date: Date): string {
  return format(date, "dd.MM.yyyy");
}

/** German day abbreviations (Mon-Sun in ISO order). */
export const dayNames = [
  "Mo",
  "Di",
  "Mi",
  "Do",
  "Fr",
  "Sa",
  "So",
] as const;

/** English day abbreviations (Mon-Sun in ISO order). */
export const dayNamesEn = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

/** German month abbreviations (index 0 = January). */
export const monthNames = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
] as const;

/** English month abbreviations (index 0 = January). */
export const monthNamesEn = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
