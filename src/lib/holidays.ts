/**
 * Feiertagsberechnung fuer Deutschland, Oesterreich und die Schweiz.
 *
 * Bewegliche Feiertage haengen am Ostersonntag und werden mit der
 * Gauss-/Meeus-Formel berechnet. Gesetzliche Feiertage einzelner Bundeslaender
 * bzw. Kantone sind beruecksichtigt, soweit sie landesweit einheitlich gelten.
 */

export interface ComputedHoliday {
  name: string;
  /** Datum als "YYYY-MM-DD" (lokal gemeint, ohne Zeitzonenverschiebung). */
  date: string;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function toISODate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Ostersonntag nach der Formel von Meeus/Jones/Butcher (gregorianisch). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Datum relativ zum Ostersonntag, als ISO-Datum. */
function easterOffset(year: number, days: number): string {
  const date = easterSunday(year);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Buss- und Bettag: der Mittwoch vor dem 23. November. */
function bussUndBettag(year: number): string {
  const date = new Date(Date.UTC(year, 10, 23));
  // Rueckwaerts bis zum vorherigen Mittwoch (Wochentag 3).
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() !== 3);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Deutschland
// ---------------------------------------------------------------------------

/** Bundeslaender, in denen der jeweilige Feiertag zusaetzlich gilt. */
const DE_STATE_HOLIDAYS: {
  name: string;
  states: string[];
  date: (year: number) => string;
}[] = [
  {
    name: "Heilige Drei Koenige",
    states: ["BW", "BY", "ST"],
    date: (y) => toISODate(y, 1, 6),
  },
  {
    name: "Internationaler Frauentag",
    states: ["BE", "MV"],
    date: (y) => toISODate(y, 3, 8),
  },
  {
    name: "Fronleichnam",
    states: ["BW", "BY", "HE", "NW", "RP", "SL"],
    date: (y) => easterOffset(y, 60),
  },
  {
    name: "Mariae Himmelfahrt",
    states: ["SL"],
    date: (y) => toISODate(y, 8, 15),
  },
  {
    name: "Weltkindertag",
    states: ["TH"],
    date: (y) => toISODate(y, 9, 20),
  },
  {
    name: "Reformationstag",
    states: ["BB", "HB", "HH", "MV", "NI", "SN", "ST", "SH", "TH"],
    date: (y) => toISODate(y, 10, 31),
  },
  {
    name: "Allerheiligen",
    states: ["BW", "BY", "NW", "RP", "SL"],
    date: (y) => toISODate(y, 11, 1),
  },
  {
    name: "Buss- und Bettag",
    states: ["SN"],
    date: bussUndBettag,
  },
];

function germanHolidays(year: number, state: string): ComputedHoliday[] {
  const holidays: ComputedHoliday[] = [
    { name: "Neujahr", date: toISODate(year, 1, 1) },
    { name: "Karfreitag", date: easterOffset(year, -2) },
    { name: "Ostermontag", date: easterOffset(year, 1) },
    { name: "Tag der Arbeit", date: toISODate(year, 5, 1) },
    { name: "Christi Himmelfahrt", date: easterOffset(year, 39) },
    { name: "Pfingstmontag", date: easterOffset(year, 50) },
    { name: "Tag der Deutschen Einheit", date: toISODate(year, 10, 3) },
    { name: "1. Weihnachtstag", date: toISODate(year, 12, 25) },
    { name: "2. Weihnachtstag", date: toISODate(year, 12, 26) },
  ];

  for (const entry of DE_STATE_HOLIDAYS) {
    if (entry.states.includes(state)) {
      holidays.push({ name: entry.name, date: entry.date(year) });
    }
  }

  return holidays;
}

// ---------------------------------------------------------------------------
// Oesterreich und Schweiz
// ---------------------------------------------------------------------------

function austrianHolidays(year: number): ComputedHoliday[] {
  return [
    { name: "Neujahr", date: toISODate(year, 1, 1) },
    { name: "Heilige Drei Koenige", date: toISODate(year, 1, 6) },
    { name: "Ostermontag", date: easterOffset(year, 1) },
    { name: "Staatsfeiertag", date: toISODate(year, 5, 1) },
    { name: "Christi Himmelfahrt", date: easterOffset(year, 39) },
    { name: "Pfingstmontag", date: easterOffset(year, 50) },
    { name: "Fronleichnam", date: easterOffset(year, 60) },
    { name: "Mariae Himmelfahrt", date: toISODate(year, 8, 15) },
    { name: "Nationalfeiertag", date: toISODate(year, 10, 26) },
    { name: "Allerheiligen", date: toISODate(year, 11, 1) },
    { name: "Mariae Empfaengnis", date: toISODate(year, 12, 8) },
    { name: "Christtag", date: toISODate(year, 12, 25) },
    { name: "Stefanitag", date: toISODate(year, 12, 26) },
  ];
}

/** Kantone mit Berchtoldstag (2. Januar) als gesetzlichem Feiertag. */
const CH_BERCHTOLDSTAG = ["ZH", "BE", "LU", "SG", "AG", "TG", "GL", "JU", "SH"];

function swissHolidays(year: number, state: string): ComputedHoliday[] {
  const holidays: ComputedHoliday[] = [
    { name: "Neujahr", date: toISODate(year, 1, 1) },
    { name: "Karfreitag", date: easterOffset(year, -2) },
    { name: "Ostermontag", date: easterOffset(year, 1) },
    { name: "Auffahrt", date: easterOffset(year, 39) },
    { name: "Pfingstmontag", date: easterOffset(year, 50) },
    { name: "Bundesfeier", date: toISODate(year, 8, 1) },
    { name: "Weihnachten", date: toISODate(year, 12, 25) },
    { name: "Stephanstag", date: toISODate(year, 12, 26) },
  ];

  if (CH_BERCHTOLDSTAG.includes(state)) {
    holidays.push({ name: "Berchtoldstag", date: toISODate(year, 1, 2) });
  }

  return holidays;
}

// ---------------------------------------------------------------------------
// Oeffentliche API
// ---------------------------------------------------------------------------

export const SUPPORTED_COUNTRIES = ["DE", "AT", "CH"] as const;

/** Alle gesetzlichen Feiertage eines Jahres, nach Datum sortiert. */
export function computeHolidays(
  country: string,
  state: string | null,
  year: number
): ComputedHoliday[] {
  const region = state ?? "";

  const holidays =
    country === "AT"
      ? austrianHolidays(year)
      : country === "CH"
        ? swissHolidays(year, region)
        : germanHolidays(year, region);

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

/** Feiertage fuer mehrere Jahre am Stueck. */
export function computeHolidaysForYears(
  country: string,
  state: string | null,
  years: number[]
): ComputedHoliday[] {
  return years.flatMap((year) => computeHolidays(country, state, year));
}
