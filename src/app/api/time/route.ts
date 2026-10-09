import { NextRequest } from "next/server";
import { z } from "zod";
import { api, body, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { recordMinutes, berlinDate, validDate } from "@/lib/berlin";
import { branchIds, can, canStaff, requireAccess, staffIds, timeScope } from "@/lib/access";
import { branchForTime } from "@/lib/time-service";

const person = { select: { id: true, firstName: true, lastName: true, profileImage: true } } as const;

/**
 * Zeitbuchungen eines Monats, gruppiert nach Person. Eigene immer; fremde nur
 * mit Standortrecht "Zeiterfassung einsehen" fuer den Standort der Buchung
 * und Personalrecht "Stunden einsehen" fuer die Person. Buchungen ohne
 * eindeutigen Standort sehen nur Admins und die Person selbst.
 */
export async function GET(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    const { searchParams } = request.nextUrl;
    const month = searchParams.get("month") || berlinDate().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError("Ungültiger Monat (JJJJ-MM).");
    const monthStart = new Date(month + "-01T00:00:00Z"), monthEnd = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const userIdParam = searchParams.get("userId");
    const records = await db.timeRecord.findMany({
      where: { AND: [timeScope(a, "view"), { date: { gte: monthStart, lt: monthEnd } }, ...(userIdParam ? [{ userId: userIdParam }] : [])] },
      include: { category: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } }, user: person },
      orderBy: [{ date: "asc" }, { timeFrom: "asc" }],
    });
    // Zeilen auch ohne Buchung: die eigene sowie Personen, deren Stunden man
    // an mindestens einem Standort sehen darf.
    const hours = staffIds(a, "VIEW_HOURS");
    const withTime = (branchIds(a, "VIEW_TIME") ?? []).length > 0;
    const rows = hours === null ? null : [a.userId, ...(withTime ? hours : [])];
    const people = await db.organizationMember.findMany({
      where: { organizationId: a.orgId, isActive: true, AND: [...(rows ? [{ userId: { in: rows } }] : []), ...(userIdParam ? [{ userId: userIdParam }] : [])] },
      include: { user: person },
    });
    const grouped = new Map<string, { userId: string; firstName: string; lastName: string; profileImage: string | null; totalHours: number; records: unknown[] }>();
    for (const p of people) grouped.set(p.userId, { userId: p.userId, firstName: p.user.firstName, lastName: p.user.lastName, profileImage: p.user.profileImage, totalHours: 0, records: [] });
    for (const { user, ...record } of records) {
      if (!grouped.has(record.userId)) grouped.set(record.userId, { userId: user.id, firstName: user.firstName, lastName: user.lastName, profileImage: user.profileImage, totalHours: 0, records: [] });
      const group = grouped.get(record.userId)!;
      group.records.push(record);
      group.totalHours += recordMinutes(record) / 60;
    }
    return { employees: [...grouped.values()].sort((x, y) => x.lastName.localeCompare(y.lastName, "de")) };
  });
}

const createManualSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("MANUAL"), breakMinutes: z.number().int().min(0).max(1440).default(0), userId: z.string().min(1),
    date: z.string().refine(validDate, "Ungültiges Datum."), timeFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    categoryId: z.string().optional(), comment: z.string().max(1000).optional(), branchId: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("MANUAL_DURATION"), breakMinutes: z.number().int().min(0).max(1440).default(0), userId: z.string().min(1),
    date: z.string().refine(validDate, "Ungültiges Datum."), durationHours: z.number().int().min(0), durationMinutes: z.number().int().min(0).max(59),
    categoryId: z.string().optional(), comment: z.string().max(1000).optional(), branchId: z.string().nullable().optional(),
  }),
]);

/**
 * Manuelle Zeitbuchung. Der Standort ergibt sich aus der Zuordnungsregel;
 * nur Admins koennen ihn ausdruecklich setzen. Fuer andere Personen braucht
 * es "Zeiterfassung bearbeiten" am ermittelten Standort und "Stunden einsehen".
 */
export async function POST(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, createManualSchema);
    if (data.type === "MANUAL" && data.timeFrom === data.timeTo) throw new ApiError("Beginn und Ende müssen unterschiedlich sein.");
    const gross = data.type === "MANUAL" ? recordMinutes({ type: data.type, timeFrom: data.timeFrom, timeTo: data.timeTo, durationHours: null, durationMinutes: null }) : data.durationHours * 60 + data.durationMinutes;
    if (data.breakMinutes > gross) throw new ApiError("Die Pause überschreitet die Arbeitszeit.");
    if (data.branchId !== undefined && !a.isAdmin) throw new ApiError("Den Standort legt die Zuordnungsregel fest.", 400);
    if (!await db.organizationMember.findFirst({ where: { organizationId: a.orgId, userId: data.userId, isActive: true } })) throw new ApiError("Nicht gefunden.", 404);
    if (data.categoryId && !await db.timeCategory.findFirst({ where: { id: data.categoryId, organizationId: a.orgId } })) throw new ApiError("Kategorie nicht gefunden.", 400);
    const times = data.type === "MANUAL" ? { timeFrom: data.timeFrom, timeTo: data.timeTo } : { timeFrom: null, timeTo: null };
    let branchId = await branchForTime(db, a.orgId, data.userId, { date: data.date, ...times });
    if (a.isAdmin && data.branchId !== undefined) {
      if (data.branchId && !await db.branch.findFirst({ where: { id: data.branchId, organizationId: a.orgId } })) throw new ApiError("Standort nicht gefunden.", 404);
      branchId = data.branchId;
    }
    if (data.userId !== a.userId && !a.isAdmin && !(branchId && can(a, "EDIT_TIME", branchId) && canStaff(a, "VIEW_HOURS", data.userId))) throw new ApiError("Nicht gefunden.", 404);
    const record = await db.timeRecord.create({
      data: {
        organizationId: a.orgId, userId: data.userId, branchId, date: new Date(data.date + "T00:00:00.000Z"), type: data.type, breakSeconds: data.breakMinutes * 60,
        ...times,
        durationHours: data.type === "MANUAL_DURATION" ? data.durationHours : null,
        durationMinutes: data.type === "MANUAL_DURATION" ? data.durationMinutes : null,
        categoryId: data.categoryId || null, comment: data.comment || null,
      },
      include: { category: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } },
    });
    return Response.json({ record }, { status: 201 });
  });
}
