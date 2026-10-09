import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";

// GET /api/time/categories — list categories for org
export async function GET() {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const categories = await db.timeCategory.findMany({
    where: { organizationId: member.organizationId },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ categories });
}

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
});

// POST /api/time/categories — create category
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

  const parsed = createCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const category = await db.timeCategory.create({
    data: {
      organizationId: member.organizationId,
      name: parsed.data.name,
    },
  });

  return NextResponse.json({ category }, { status: 201 });
}

const updateCategorySchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().optional(),
  name: z.string().min(1).max(100).optional(),
});

// PATCH /api/time/categories — enable/disable or rename category
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

  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { id, ...data } = parsed.data;

  // Verify belongs to org
  const existing = await db.timeCategory.findFirst({
    where: { id, organizationId: member.organizationId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await db.timeCategory.update({
    where: { id },
    data,
  });

  return NextResponse.json({ category: updated });
}

// DELETE /api/time/categories — delete category
export async function DELETE(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Verify belongs to org
  const existing = await db.timeCategory.findFirst({
    where: { id, organizationId: member.organizationId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Nullify categoryId on related records instead of cascading
  await db.timeRecord.updateMany({
    where: { categoryId: id },
    data: { categoryId: null },
  });

  await db.timeCategory.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
