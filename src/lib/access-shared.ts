/**
 * Rechte, Bezeichnungen und Voreinstellungen - gemeinsam fuer Server und
 * Oberflaeche. Die Durchsetzung liegt ausschliesslich in src/lib/access.ts.
 */
export type RoleKey = "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE";
export type BranchRightKey =
  | "VIEW_SCHEDULE"
  | "EDIT_SHIFTS"
  | "PUBLISH_SCHEDULE"
  | "HANDLE_REQUESTS"
  | "VIEW_TIME"
  | "EDIT_TIME"
  | "MANAGE_ISSUES"
  | "REQUEST_SHIFTS";
export type StaffRightKey = "ASSIGN_SHIFTS" | "VIEW_PROFILE" | "EDIT_PROFILE" | "MANAGE_ABSENCES" | "VIEW_HOURS";

export const BRANCH_RIGHTS: { key: BranchRightKey; label: string; hint: string }[] = [
  { key: "VIEW_SCHEDULE", label: "Dienstplan ansehen", hint: "Vollständiger Standortplan mit den Namen der Eingeteilten. Manager sehen auch Entwürfe." },
  { key: "EDIT_SHIFTS", label: "Schichten erstellen und bearbeiten", hint: "Schichten anlegen, ändern, kopieren und besetzen." },
  { key: "PUBLISH_SCHEDULE", label: "Dienstplan veröffentlichen", hint: "Wochenpläne freigeben oder zurückziehen." },
  { key: "HANDLE_REQUESTS", label: "Anträge und Schichtübernahmen bearbeiten", hint: "Übernahmen und Tauschanfragen entscheiden." },
  { key: "VIEW_TIME", label: "Zeiterfassung und Auswertungen einsehen", hint: "Gilt nur für Personen mit dem Personalrecht „Stunden einsehen“." },
  { key: "EDIT_TIME", label: "Zeiterfassung bearbeiten", hint: "Zeitkorrekturen entscheiden und Zeiten nachtragen." },
  { key: "MANAGE_ISSUES", label: "Standortmeldungen bearbeiten", hint: "Interne Meldungen ansehen, anlegen und bearbeiten." },
  { key: "REQUEST_SHIFTS", label: "Offene Schichten sehen und anfragen", hint: "Offene Plätze ohne Namen anderer Personen; Übernahme anfragen." },
];

export const STAFF_RIGHTS: { key: StaffRightKey; label: string; hint: string }[] = [
  { key: "ASSIGN_SHIFTS", label: "In Schichten einplanen", hint: "Person steht beim Besetzen zur Auswahl; Verfügbarkeiten sind sichtbar." },
  { key: "VIEW_PROFILE", label: "Personalprofil ansehen", hint: "Kontaktdaten, Tätigkeit und Qualifikationen." },
  { key: "EDIT_PROFILE", label: "Stammdaten bearbeiten", hint: "Tätigkeit, Beschäftigungsart, Sollstunden, Qualifikationen und Notizen." },
  { key: "MANAGE_ABSENCES", label: "Abwesenheiten einsehen und entscheiden", hint: "Anträge sehen, genehmigen und ablehnen." },
  { key: "VIEW_HOURS", label: "Stunden einsehen", hint: "Zeitbuchungen und Monatswerte – nur an Standorten mit „Zeiterfassung einsehen“." },
];

/** Wer ein Recht hat, hat auch die hier genannten. */
const BRANCH_IMPLIES: Partial<Record<BranchRightKey, BranchRightKey[]>> = {
  EDIT_SHIFTS: ["VIEW_SCHEDULE"],
  PUBLISH_SCHEDULE: ["VIEW_SCHEDULE"],
  HANDLE_REQUESTS: ["VIEW_SCHEDULE"],
  VIEW_SCHEDULE: ["REQUEST_SHIFTS"],
  EDIT_TIME: ["VIEW_TIME"],
};
const STAFF_IMPLIES: Partial<Record<StaffRightKey, StaffRightKey[]>> = {
  EDIT_PROFILE: ["VIEW_PROFILE"],
};

export function isAdminRole(role?: string | null): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Die Rolle bestimmt, welche Standortrechte ueberhaupt vergeben werden koennen. */
export function allowedBranchRights(role?: string | null): BranchRightKey[] {
  if (role === "MANAGER") return BRANCH_RIGHTS.map((r) => r.key);
  if (role === "EMPLOYEE") return ["VIEW_SCHEDULE", "REQUEST_SHIFTS"];
  return [];
}

/** Personalrechte gibt es nur fuer Manager; Admins haben sie ohnehin. */
export function allowedStaffRights(role?: string | null): StaffRightKey[] {
  return role === "MANAGER" ? STAFF_RIGHTS.map((r) => r.key) : [];
}

function closure<K extends string>(rights: readonly string[], allowed: readonly K[], implies: Partial<Record<K, K[]>>, order: readonly K[]): K[] {
  const permitted = new Set<string>(allowed);
  const result = new Set<K>();
  const add = (right: string) => {
    if (!permitted.has(right) || result.has(right as K)) return;
    result.add(right as K);
    for (const implied of implies[right as K] ?? []) add(implied);
  };
  for (const right of rights) add(right);
  return order.filter((key) => result.has(key));
}

/** Rechte einschliesslich Folgerechte, beschraenkt auf das, was die Rolle erlaubt. */
export function normalizeBranchRights(rights: readonly string[], role?: string | null): BranchRightKey[] {
  return closure(rights, allowedBranchRights(role), BRANCH_IMPLIES, BRANCH_RIGHTS.map((r) => r.key));
}
export function normalizeStaffRights(rights: readonly string[], role?: string | null): StaffRightKey[] {
  return closure(rights, allowedStaffRights(role), STAFF_IMPLIES, STAFF_RIGHTS.map((r) => r.key));
}

/** Voreinstellungen fuer die Vergabe in der Oberflaeche. */
export const BRANCH_PRESETS: Record<"MANAGER" | "EMPLOYEE", { label: string; rights: BranchRightKey[] }[]> = {
  MANAGER: [
    { label: "Plan ansehen", rights: ["VIEW_SCHEDULE"] },
    { label: "Planen", rights: ["VIEW_SCHEDULE", "EDIT_SHIFTS", "HANDLE_REQUESTS"] },
    { label: "Standortverantwortung", rights: BRANCH_RIGHTS.filter((r) => r.key !== "REQUEST_SHIFTS").map((r) => r.key) },
  ],
  EMPLOYEE: [
    { label: "Offene Schichten", rights: ["REQUEST_SHIFTS"] },
    { label: "Standortplan ansehen", rights: ["VIEW_SCHEDULE"] },
  ],
};
export const STAFF_PRESETS: { label: string; rights: StaffRightKey[] }[] = [
  { label: "Einplanen", rights: ["ASSIGN_SHIFTS", "VIEW_PROFILE"] },
  { label: "Personalverantwortung", rights: STAFF_RIGHTS.map((r) => r.key) },
];

/** Rechte der angemeldeten Person, wie /api/me sie an die Oberflaeche gibt. */
export type AccessSummary = {
  isAdmin: boolean;
  branches: Record<string, BranchRightKey[]>;
  staff: Record<string, StaffRightKey[]>;
};

export function summaryCan(summary: AccessSummary | undefined, right: BranchRightKey, branchId?: string | null): boolean {
  if (!summary) return false;
  if (summary.isAdmin) return true;
  if (branchId) return summary.branches[branchId]?.includes(right) ?? false;
  return Object.values(summary.branches).some((rights) => rights.includes(right));
}
export function summaryStaff(summary: AccessSummary | undefined, right: StaffRightKey): boolean {
  if (!summary) return false;
  return summary.isAdmin || Object.values(summary.staff).some((rights) => rights.includes(right));
}
