/**
 * Shared types for schedule, shift, and booking data
 * as returned by the API. Die API gibt nur aus, was die angemeldete
 * Person sehen darf; Rechte stehen in "can" bzw. "access".
 */

export type BookingUser = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  profileImage: string | null;
};

export type ShiftBooking = {
  confirmedAt?: string | null;
  id: string;
  shiftId: string;
  userId: string;
  bookedAt: string;
  /** Nur fuer die Planung: Konto inaktiv oder genehmigte Abwesenheit. */
  unavailable?: boolean;
  user: BookingUser;
};

export type ShiftDivision = {
  id: string;
  title: string;
  color: string;
};

export type ShiftBranch = {
  id: string;
  name: string;
  address: string | null;
  meetingPoint: string | null;
  notes: string | null;
  customer: { id: string; name: string } | null;
};

export type ShiftData = {
  branchId?: string | null;
  branch?: ShiftBranch | null;
  requiredQualifications?: string[];
  occupiedCount?: number;
  /** Fehlende Besetzung: benoetigte minus wirksam zugewiesene Plaetze. */
  missing?: number;
  date?: string;
  endsNextDay?: boolean;
  isPublic?: boolean;
  can?: { edit: boolean; handle: boolean; request: boolean };
  id: string;
  scheduleId: string;
  divisionId: string | null;
  dayOfWeek: number;
  shiftFrom: string;
  shiftTo: string;
  maxEmployees: number;
  pauseOption: "PER_HOUR" | "PER_SHIFT";
  pauseValue: number;
  title: string | null;
  description: string | null;
  createdAt: string;
  deletedAt: string | null;
  division: ShiftDivision | null;
  bookings: ShiftBooking[];
};

export type ScheduleLayout = "LAYOUT_1" | "LAYOUT_2";

export type BriefingData = {
  id: string;
  scheduleId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleData = {
  id: string;
  organizationId: string;
  branchId?: string | null;
  weekNumber: number;
  year: number;
  isPublic: boolean;
  settingsLayout: ScheduleLayout;
  showTitle: boolean;
  showPauses: boolean;
  shifts: ShiftData[];
};

/** Rechte der angemeldeten Person an einem Standortplan. */
export type ScheduleAccess = {
  view: boolean;
  planner: boolean;
  edit: boolean;
  publish: boolean;
  handleRequests: boolean;
  request: boolean;
  /** Zeiterfassung dieses Standorts einsehen (Stunden anderer zusaetzlich nur mit Personalrecht). */
  viewTime?: boolean;
};

export type ScheduleResponse = {
  schedule: ScheduleData;
  branch?: { id: string; name: string; isActive: boolean; plannable: boolean; customer: { id: string; name: string } | null } | null;
  access?: ScheduleAccess;
  merged?: boolean;
};

export type DivisionOption = {
  id: string;
  title: string;
  color: string;
};
