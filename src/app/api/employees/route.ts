import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireAccess, requireAdmin } from "@/lib/access";

/**
 * Personalliste. Admins sehen alle, Manager nur ihnen ausdruecklich
 * zugeordnete Personen - Kontaktdaten nur mit "Personalprofil ansehen".
 * Mitarbeitende haben keine Personalliste.
 */
export async function GET(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    if (!a.isAdmin && a.role !== "MANAGER") throw new ApiError("Keine Berechtigung.", 403);
    const { searchParams } = request.nextUrl;
    const search = searchParams.get("search") || "";
    const role = searchParams.get("role") || "";
    const status = searchParams.get("status") || "";
    const staff = a.isAdmin ? null : [...a.staff.keys()];

    const where: Record<string, unknown> = { organizationId: a.orgId, ...(staff ? { userId: { in: staff } } : {}) };
    if (status === "inactive") where.isActive = false;
    else if (status === "not_activated") { where.isActive = true; where.isActivated = false; }
    else if (status !== "all") where.isActive = true;
    if (role && role !== "all") where.role = role.toUpperCase();

    const members = await db.organizationMember.findMany({
      where: {
        ...where,
        ...(search ? { user: { OR: [
          { firstName: { contains: search, mode: "insensitive" as const } },
          { lastName: { contains: search, mode: "insensitive" as const } },
          // Suche ueber E-Mail nur, wo die E-Mail auch sichtbar ist.
          ...(a.isAdmin ? [{ email: { contains: search, mode: "insensitive" as const } }] : []),
        ] } } : {}),
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, nickname: true, profileImage: true } } },
      orderBy: { joinedAt: "asc" },
    });
    const all = await db.organizationMember.findMany({ where: { organizationId: a.orgId, ...(staff ? { userId: { in: staff } } : {}) }, select: { role: true, isActive: true, isActivated: true } });
    const counts = {
      all: all.filter((m) => m.isActive).length,
      admin: all.filter((m) => m.isActive && m.role === "ADMIN").length,
      manager: all.filter((m) => m.isActive && m.role === "MANAGER").length,
      not_activated: all.filter((m) => m.isActive && !m.isActivated).length,
      inactive: all.filter((m) => !m.isActive).length,
    };

    return {
      members: members.map((m) => {
        const profile = a.isAdmin || (a.staff.get(m.userId)?.rights.has("VIEW_PROFILE") ?? false);
        const { email, phone, nickname, ...name } = m.user;
        return {
          id: m.id, role: m.role, isActive: m.isActive, isActivated: m.isActivated, joinedAt: m.joinedAt,
          user: profile ? { ...name, email, phone, nickname } : { ...name, email: null, phone: null, nickname: null },
          rights: a.isAdmin ? null : [...(a.staff.get(m.userId)?.rights ?? [])],
        };
      }),
      counts,
    };
  });
}

const createEmployeeSchema = z.object({
  employees: z.array(z.object({ firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email(), role: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]) })),
});

// POST /api/employees - Konten anlegen (nur Admins)
export async function POST(request: NextRequest) {
  return api(async () => {
    const a = await requireAccess();
    requireAdmin(a);
    let raw: unknown;
    try { raw = await request.json(); } catch { throw new ApiError("Ungültige Anfrage."); }
    const { employees } = createEmployeeSchema.parse(raw);

    const emails = employees.map((e) => e.email.toLowerCase());
    if (new Set(emails).size !== emails.length) throw new ApiError("E-Mail-Adressen sind doppelt angegeben.");
    const existingUsers = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
    const existingEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));
    if (existingUsers.length > 0) {
      const memberships = await db.organizationMember.findMany({ where: { organizationId: a.orgId, userId: { in: existingUsers.map((u) => u.id) } }, select: { userId: true } });
      const already = new Set(memberships.map((m) => m.userId));
      const duplicates = existingUsers.filter((u) => already.has(u.id)).map((u) => u.email);
      if (duplicates.length) return NextResponse.json({ error: "Some employees are already members", emails: duplicates }, { status: 409 });
    }

    const createdMembers = await db.$transaction(async (tx) => {
      const results = [];
      for (const emp of employees) {
        const user = existingEmails.has(emp.email.toLowerCase())
          ? existingUsers.find((u) => u.email.toLowerCase() === emp.email.toLowerCase())!
          : await tx.user.create({ data: { email: emp.email.toLowerCase(), firstName: emp.firstName, lastName: emp.lastName, passwordHash: await bcrypt.hash(crypto.randomUUID(), 10) } });
        results.push(await tx.organizationMember.create({
          data: { organizationId: a.orgId, userId: user.id, role: emp.role, isActivated: false, activationToken: crypto.randomUUID(), activationExpiresAt: new Date(Date.now() + 7 * 86400000) },
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, nickname: true, profileImage: true } } },
        }));
      }
      return results;
    });
    return NextResponse.json({ members: createdMembers.map(({ activationToken: _t, activationExpiresAt: _e, ...m }) => { void _t; void _e; return m; }) }, { status: 201 });
  });
}
