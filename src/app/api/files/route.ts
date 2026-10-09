import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";

// GET /api/files?folderId=xxx (null/omit for root)
export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const folderId = request.nextUrl.searchParams.get("folderId") || null;
  const orgId = member.organizationId;

  // Get folders at this level
  const folders = await db.portalFolder.findMany({
    where: { organizationId: orgId, parentId: folderId },
    orderBy: { name: "asc" },
  });

  // Get files at this level
  const files = await db.portalFile.findMany({
    where: { organizationId: orgId, folderId },
    include: {
      uploadedBy: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
    orderBy: { name: "asc" },
  });

  // Build breadcrumb
  const breadcrumb: { id: string; name: string }[] = [];
  let currentFolderId = folderId;
  while (currentFolderId) {
    const folder = await db.portalFolder.findUnique({
      where: { id: currentFolderId },
      select: { id: true, name: true, parentId: true },
    });
    if (!folder) break;
    breadcrumb.unshift({ id: folder.id, name: folder.name });
    currentFolderId = folder.parentId;
  }

  return NextResponse.json({ folders, files, breadcrumb });
}

// POST /api/files — create folder
const createFolderSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().nullable().optional(),
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

  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { name, parentId } = parsed.data;

  // Verify parent folder if provided
  if (parentId) {
    const parent = await db.portalFolder.findFirst({
      where: { id: parentId, organizationId: member.organizationId },
    });
    if (!parent) {
      return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
    }
  }

  const folder = await db.portalFolder.create({
    data: {
      organizationId: member.organizationId,
      name,
      parentId: parentId || null,
    },
  });

  return NextResponse.json({ folder }, { status: 201 });
}
