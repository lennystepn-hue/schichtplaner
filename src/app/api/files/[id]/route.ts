import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";

const renameSchema = z.object({
  name: z.string().min(1).max(100),
});

// PATCH /api/files/[id] — rename folder or file
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  // Try folder first, then file
  const folder = await db.portalFolder.findFirst({
    where: { id, organizationId: member.organizationId },
  });

  if (folder) {
    const updated = await db.portalFolder.update({
      where: { id },
      data: { name: parsed.data.name },
    });
    return NextResponse.json({ folder: updated });
  }

  const file = await db.portalFile.findFirst({
    where: { id, organizationId: member.organizationId },
  });

  if (file) {
    const updated = await db.portalFile.update({
      where: { id },
      data: { name: parsed.data.name },
    });
    return NextResponse.json({ file: updated });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// DELETE /api/files/[id] — delete folder or file
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Try folder first, then file
  const folder = await db.portalFolder.findFirst({
    where: { id, organizationId: member.organizationId },
  });

  if (folder) {
    await db.portalFolder.delete({ where: { id } });
    return NextResponse.json({ success: true });
  }

  const file = await db.portalFile.findFirst({
    where: { id, organizationId: member.organizationId },
  });

  if (file) {
    await db.portalFile.delete({ where: { id } });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
