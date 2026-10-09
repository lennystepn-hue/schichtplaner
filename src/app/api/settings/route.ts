import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";
import { SUPPORTED_COUNTRIES, computeHolidaysForYears } from "@/lib/holidays";

// GET /api/settings — get all settings for the org
export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const org = await db.organization.findUnique({
    where: { id: member.organizationId },
    include: {
      timeSettings: true,
      absenceCategories: {
        orderBy: { name: "asc" },
      },
      holidays: {
        orderBy: { date: "asc" },
      },
      settings: true,
    },
  });

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  return NextResponse.json({
    organization: {
      id: org.id,
      name: org.name,
      address: org.address,
      nameFormat: org.nameFormat,
    },
    timeSettings: org.timeSettings ?? {
      whoCanUse: "ALL",
      watchAutoStop: false,
      warningsEnabled: false,
      warningsMaxHours: 10,
      useCategories: false,
    },
    absenceCategories: org.absenceCategories,
    holidays: org.holidays,
    orgSettings: org.settings ?? {
      aiEnabled: false,
      aiAutoPlanner: false,
      aiAnomalyDetection: false,
      aiChatEnabled: false,
      aiForecast: false,
      aiSmartBriefing: false,
      smsEnabled: false,
    },
  });
}

// PATCH /api/settings — update settings
const updateSettingsSchema = z.object({
  // Organization fields
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  nameFormat: z
    .enum([
      "LASTNAME_FIRSTNAME",
      "FIRSTNAME_LASTNAME",
      "LASTNAME",
      "FIRSTNAME",
      "NICKNAME",
    ])
    .optional(),

  // Time settings
  timeSettings: z
    .object({
      whoCanUse: z.enum(["ALL", "CHOOSE"]).optional(),
      watchAutoStop: z.boolean().optional(),
      warningsEnabled: z.boolean().optional(),
      warningsMaxHours: z.number().int().min(1).max(24).optional(),
      useCategories: z.boolean().optional(),
    })
    .optional(),

  // Holiday location
  holidayCountry: z.enum(SUPPORTED_COUNTRIES).optional(),
  holidayState: z.string().max(4).optional(),
});

/** Wie viele Jahre im Voraus Feiertage angelegt werden. */
const HOLIDAY_YEARS_AHEAD = 2;

/**
 * Legt die Feiertage fuer das gewaehlte Land/Bundesland neu an.
 * Vergangene Jahre bleiben unveraendert, damit alte Plaene stimmig bleiben.
 */
async function regenerateHolidays(
  organizationId: string,
  country: string,
  state: string | null
) {
  const currentYear = new Date().getFullYear();
  const years = Array.from(
    { length: HOLIDAY_YEARS_AHEAD + 1 },
    (_, index) => currentYear + index
  );

  const holidays = computeHolidaysForYears(country, state, years);

  await db.$transaction([
    db.holiday.deleteMany({
      where: {
        organizationId,
        date: { gte: new Date(`${currentYear}-01-01T00:00:00.000Z`) },
      },
    }),
    db.holiday.createMany({
      data: holidays.map((holiday) => ({
        organizationId,
        name: holiday.name,
        date: new Date(`${holiday.date}T00:00:00.000Z`),
        country,
        state: state || null,
      })),
    }),
  ]);
}

export async function PATCH(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Update organization fields
  const orgUpdate: Record<string, unknown> = {};
  if (data.name !== undefined) orgUpdate.name = data.name;
  if (data.address !== undefined) orgUpdate.address = data.address;
  if (data.nameFormat !== undefined) orgUpdate.nameFormat = data.nameFormat;

  if (Object.keys(orgUpdate).length > 0) {
    await db.organization.update({
      where: { id: member.organizationId },
      data: orgUpdate,
    });
  }

  // Update time settings
  if (data.timeSettings) {
    const ts = data.timeSettings;
    const tsUpdate: Record<string, unknown> = {};
    if (ts.whoCanUse !== undefined) tsUpdate.whoCanUse = ts.whoCanUse;
    if (ts.watchAutoStop !== undefined) tsUpdate.watchAutoStop = ts.watchAutoStop;
    if (ts.warningsEnabled !== undefined)
      tsUpdate.warningsEnabled = ts.warningsEnabled;
    if (ts.warningsMaxHours !== undefined)
      tsUpdate.warningsMaxHours = ts.warningsMaxHours;
    if (ts.useCategories !== undefined) tsUpdate.useCategories = ts.useCategories;

    if (Object.keys(tsUpdate).length > 0) {
      await db.timeSettings.upsert({
        where: { organizationId: member.organizationId },
        create: {
          organizationId: member.organizationId,
          ...tsUpdate,
        },
        update: tsUpdate,
      });
    }
  }

  // Feiertage: Land/Bundesland merken und den Kalender neu aufbauen.
  if (data.holidayCountry !== undefined || data.holidayState !== undefined) {
    const existing = await db.holiday.findFirst({
      where: { organizationId: member.organizationId },
      orderBy: { date: "desc" },
      select: { country: true, state: true },
    });

    const country = data.holidayCountry ?? existing?.country ?? "DE";
    // Beim Wechsel des Landes passt ein altes Bundesland nicht mehr.
    const state =
      data.holidayState !== undefined
        ? data.holidayState || null
        : data.holidayCountry !== undefined
          ? null
          : (existing?.state ?? null);

    await regenerateHolidays(member.organizationId, country, state);
  }

  return NextResponse.json({ success: true });
}
