/**
 * Zentrale, serverseitige Berechtigungslogik.
 *
 * - Die Rolle bestimmt die grundsaetzlich moeglichen Aktionen.
 * - Eine Standortfreigabe (branch_access) bestimmt, fuer welche Standorte sie
 *   gelten. Ohne gueltige Freigabe gibt es keinen Zugriff.
 * - Rechte auf Personaldaten entstehen nur ueber eine ausdrueckliche
 *   Personalzuordnung (staff_assignments) mit passendem Einzelrecht.
 * - OWNER und ADMIN haben organisationsweiten Zugriff.
 *
 * Alles wird bei jeder Anfrage frisch aus der Datenbank geladen: Entzug und
 * Deaktivierung wirken spaetestens bei der naechsten Serveranfrage.
 * Oberflaechen duerfen sich an den Rechten orientieren, ersetzen aber keine
 * dieser Pruefungen.
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { getCurrentMember } from "./auth-helpers";
import { ApiError } from "./errors";
import {
  isAdminRole,
  normalizeBranchRights,
  normalizeStaffRights,
  type AccessSummary,
  type BranchRightKey,
  type StaffRightKey,
} from "./access-shared";

type Tx = Prisma.TransactionClient;
export type CurrentMember = NonNullable<Awaited<ReturnType<typeof getCurrentMember>>>;

export type Access = {
  member: CurrentMember;
  orgId: string;
  userId: string;
  memberId: string;
  role: string;
  isAdmin: boolean;
  /** Standort -> Rechte (inklusive Folgerechte, beschraenkt auf die Rolle). */
  branches: Map<string, Set<BranchRightKey>>;
  /** userId der zugeordneten Person -> Personalrechte (nur Manager). */
  staff: Map<string, { memberId: string; rights: Set<StaffRightKey> }>;
};

export async function accessFor(member: CurrentMember, tx: Tx = db): Promise<Access> {
  const isAdmin = isAdminRole(member.role);
  const branches = new Map<string, Set<BranchRightKey>>();
  const staff = new Map<string, { memberId: string; rights: Set<StaffRightKey> }>();
  if (!isAdmin) {
    const [grants, assignments] = await Promise.all([
      tx.branchAccess.findMany({ where: { memberId: member.id, organizationId: member.organizationId }, select: { branchId: true, rights: true } }),
      member.role === "MANAGER"
        ? tx.staffAssignment.findMany({
            where: { managerMemberId: member.id, organizationId: member.organizationId, employee: { isActive: true } },
            select: { rights: true, employee: { select: { id: true, userId: true } } },
          })
        : Promise.resolve([]),
    ]);
    for (const grant of grants) {
      const rights = normalizeBranchRights(grant.rights, member.role);
      if (rights.length) branches.set(grant.branchId, new Set(rights));
    }
    for (const assignment of assignments) {
      const rights = normalizeStaffRights(assignment.rights, member.role);
      if (rights.length) staff.set(assignment.employee.userId, { memberId: assignment.employee.id, rights: new Set(rights) });
    }
  }
  return { member, orgId: member.organizationId, userId: member.userId, memberId: member.id, role: member.role, isAdmin, branches, staff };
}

export async function requireAccess(): Promise<Access> {
  const member = await getCurrentMember();
  if (!member) throw new ApiError("Bitte erneut anmelden.", 401);
  return accessFor(member);
}

export function requireAdmin(a: Access) {
  if (!a.isAdmin) throw new ApiError("Keine Berechtigung.", 403);
}

// --- Standortrechte --------------------------------------------------------

export function can(a: Access, right: BranchRightKey, branchId: string | null | undefined): boolean {
  if (a.isAdmin) return true;
  if (!branchId) return false; // Altbestand ohne Standort: nur Admins
  return a.branches.get(branchId)?.has(right) ?? false;
}

/** Wirft 404, wenn der Standort gar nicht sichtbar ist, sonst 403. */
export function assertCan(a: Access, right: BranchRightKey, branchId: string | null | undefined, message = "Keine Berechtigung fuer diesen Standort.") {
  if (can(a, right, branchId)) return;
  const visible = a.isAdmin || (!!branchId && a.branches.has(branchId));
  throw new ApiError(visible ? message : "Nicht gefunden.", visible ? 403 : 404);
}

/** Standorte mit diesem Recht; null bedeutet: alle (Admin). */
export function branchIds(a: Access, right: BranchRightKey): string[] | null {
  if (a.isAdmin) return null;
  return [...a.branches].filter(([, rights]) => rights.has(right)).map(([id]) => id);
}

/** Standorte mit irgendeinem Recht; null bedeutet: alle (Admin). */
export function anyBranchIds(a: Access): string[] | null {
  return a.isAdmin ? null : [...a.branches.keys()];
}

/** Filter fuer Wochenplaene, auf die ein Recht zutrifft (niemals Altbestand fuer Nicht-Admins). */
export function scheduleScope(a: Access, right: BranchRightKey): Prisma.ScheduleWhereInput {
  const ids = branchIds(a, right);
  return { organizationId: a.orgId, ...(ids ? { branchId: { in: ids } } : {}) };
}

// --- Personalrechte --------------------------------------------------------

export function canStaff(a: Access, right: StaffRightKey, userId: string): boolean {
  if (a.isAdmin) return true;
  return a.staff.get(userId)?.rights.has(right) ?? false;
}

/** Zugeordnete Personen mit diesem Recht; null bedeutet: alle (Admin). */
export function staffIds(a: Access, right: StaffRightKey): string[] | null {
  if (a.isAdmin) return null;
  return [...a.staff].filter(([, s]) => s.rights.has(right)).map(([id]) => id);
}

/**
 * Welche Zeitbuchungen sichtbar (view) bzw. bearbeitbar (edit) sind.
 * Stunden einer anderen Person brauchen beides: das Standortrecht fuer den
 * Standort der Buchung und das Personalrecht "Stunden einsehen". Buchungen
 * ohne eindeutigen Standort sehen nur Admins und die Person selbst.
 */
export function timeScope(a: Access, mode: "view" | "edit"): Prisma.TimeRecordWhereInput {
  if (a.isAdmin) return { organizationId: a.orgId };
  const branches = branchIds(a, mode === "view" ? "VIEW_TIME" : "EDIT_TIME") ?? [];
  const people = (staffIds(a, "VIEW_HOURS") ?? []).filter((id) => id !== a.userId);
  const others: Prisma.TimeRecordWhereInput = { branchId: { in: branches }, userId: { in: people } };
  // Eigene Buchungen: ansehen ja, selbst freigeben nein.
  return { organizationId: a.orgId, OR: mode === "view" ? [{ userId: a.userId }, others] : [others] };
}

export function canSeeTime(a: Access, record: { userId: string; branchId: string | null }, mode: "view" | "edit"): boolean {
  if (a.isAdmin) return true;
  if (mode === "view" && record.userId === a.userId) return true;
  if (record.userId === a.userId) return false;
  return !!record.branchId && can(a, mode === "view" ? "VIEW_TIME" : "EDIT_TIME", record.branchId) && canStaff(a, "VIEW_HOURS", record.userId);
}

// --- Sichtbare Personen ----------------------------------------------------

/**
 * Personen, deren Namen die angemeldete Person sehen und denen sie schreiben
 * darf. null bedeutet: alle (Admin).
 *
 * - sich selbst sowie Inhaber und Administration (Ansprechpartner)
 * - Manager: zugeordnete Personen und alle, die in Plaenen ihrer
 *   Standorte mit "Dienstplan ansehen" eingeteilt sind (auch Entwuerfe)
 * - Mitarbeitende: ihre Personalverantwortlichen, die Planung ihrer eigenen
 *   Einsatzorte und - nur mit Freigabe "Dienstplan ansehen" - die in
 *   veroeffentlichten Plaenen dieses Standorts Eingeteilten
 */
export async function visiblePeople(a: Access, tx: Tx = db): Promise<Set<string> | null> {
  if (a.isAdmin) return null;
  const year = Number(new Date().getUTCFullYear());
  const window = { year: { gte: year - 1, lte: year + 1 }, deletedAt: null };
  const people = new Set<string>([a.userId]);
  const viewBranches = branchIds(a, "VIEW_SCHEDULE") ?? [];
  const manager = a.role === "MANAGER";
  const [leaders, responsible, colleagues, ownBranches] = await Promise.all([
    tx.organizationMember.findMany({ where: { organizationId: a.orgId, isActive: true, role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } }),
    tx.staffAssignment.findMany({ where: { organizationId: a.orgId, employeeMemberId: a.memberId, manager: { isActive: true, role: "MANAGER" } }, select: { manager: { select: { userId: true } } } }),
    viewBranches.length
      ? tx.booking.findMany({
          where: { shift: { deletedAt: null, schedule: { organizationId: a.orgId, branchId: { in: viewBranches }, ...window, ...(manager ? {} : { isPublic: true }) } } },
          select: { userId: true },
          distinct: ["userId"],
        })
      : Promise.resolve([]),
    tx.schedule.findMany({
      where: { organizationId: a.orgId, branchId: { not: null }, isPublic: true, ...window, shifts: { some: { deletedAt: null, bookings: { some: { userId: a.userId } } } } },
      select: { branchId: true },
      distinct: ["branchId"],
    }),
  ]);
  for (const m of leaders) people.add(m.userId);
  for (const s of responsible) people.add(s.manager.userId);
  for (const b of colleagues) people.add(b.userId);
  for (const userId of a.staff.keys()) people.add(userId);
  const planningBranches = ownBranches.map((s) => s.branchId!).filter(Boolean);
  if (planningBranches.length) {
    const planners = await tx.branchAccess.findMany({
      where: { organizationId: a.orgId, branchId: { in: planningBranches }, rights: { hasSome: ["EDIT_SHIFTS", "HANDLE_REQUESTS"] }, member: { isActive: true, role: "MANAGER" } },
      select: { member: { select: { userId: true } } },
    });
    for (const p of planners) people.add(p.member.userId);
  }
  return people;
}

export function canSee(people: Set<string> | null, userId: string): boolean {
  return people === null || people.has(userId);
}

// --- Empfaenger fuer Benachrichtigungen -------------------------------------

async function adminIds(tx: Tx, orgId: string): Promise<string[]> {
  const admins = await tx.organizationMember.findMany({ where: { organizationId: orgId, isActive: true, role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } });
  return admins.map((m) => m.userId);
}

/**
 * Wer an einem Standort eines der Rechte haelt (aktive Mitglieder, nach
 * Rolle bereinigt). Admins sind nur dabei, wenn includeAdmins gesetzt ist.
 */
export async function branchHolders(tx: Tx, orgId: string, branchId: string | null, rights: BranchRightKey[], includeAdmins = true): Promise<string[]> {
  const ids = new Set<string>(includeAdmins ? await adminIds(tx, orgId) : []);
  if (branchId) {
    const grants = await tx.branchAccess.findMany({
      where: { organizationId: orgId, branchId, member: { isActive: true, isActivated: true, role: { in: ["MANAGER", "EMPLOYEE"] } } },
      select: { rights: true, member: { select: { userId: true, role: true } } },
    });
    for (const g of grants) if (normalizeBranchRights(g.rights, g.member.role).some((r) => rights.includes(r))) ids.add(g.member.userId);
  }
  return [...ids];
}

/** Admins und Manager mit diesem Personalrecht fuer die Person. */
export async function staffHolders(tx: Tx, orgId: string, employeeUserId: string, right: StaffRightKey): Promise<string[]> {
  const ids = new Set(await adminIds(tx, orgId));
  const assignments = await tx.staffAssignment.findMany({
    where: { organizationId: orgId, employee: { userId: employeeUserId }, manager: { isActive: true, isActivated: true, role: "MANAGER" } },
    select: { rights: true, manager: { select: { userId: true, role: true } } },
  });
  for (const s of assignments) if (normalizeStaffRights(s.rights, s.manager.role).includes(right)) ids.add(s.manager.userId);
  return [...ids];
}

/** Zusammenfassung fuer die Oberflaeche (Navigation, Schaltflaechen). */
export function summary(a: Access): AccessSummary {
  return {
    isAdmin: a.isAdmin,
    branches: Object.fromEntries([...a.branches].map(([id, rights]) => [id, [...rights]])),
    staff: Object.fromEntries([...a.staff].map(([userId, s]) => [userId, [...s.rights]])),
  };
}
