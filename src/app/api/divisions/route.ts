import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";

// GET /api/divisions - List all divisions for the current org
export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const divisions = await db.division.findMany({
    where: {
      organizationId: member.organizationId,
      deletedAt: null,
    },
    include: {
      _count: {
        select: { members: true },
      },
    },
    orderBy: [
      { isSystem: "desc" }, // System division "Alle" always first
      { createdAt: "asc" },
    ],
  });

  // Arbeitsbereiche selbst sind fuer die Planung sichtbar; wie viele Personen
  // dazugehoeren, ist Personaldaten und bleibt der Administration vorbehalten.
  const admin = isAdminOrAbove(member.role);
  const result = divisions.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    color: d.color,
    isSystem: d.isSystem,
    memberCount: admin ? d._count.members : null,
    createdAt: d.createdAt,
  }));

  return NextResponse.json({ divisions: result });
}

// POST /api/divisions - Create a new division
const createDivisionSchema = z.object({
  title: z.string().min(1, "Titel ist erforderlich").max(100, "Titel darf maximal 100 Zeichen haben"),
  description: z.string().max(500).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Ungueltige Farbe"),
});

export async function POST(request: NextRequest) {
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

  const parsed = createDivisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const division = await db.division.create({
    data: {
      organizationId: member.organizationId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      color: parsed.data.color,
    },
    include: {
      _count: {
        select: { members: true },
      },
    },
  });

  return NextResponse.json(
    {
      division: {
        id: division.id,
        title: division.title,
        description: division.description,
        color: division.color,
        isSystem: division.isSystem,
        memberCount: division._count.members,
        createdAt: division.createdAt,
      },
    },
    { status: 201 }
  );
}
