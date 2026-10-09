/*
 * Berechtigungen nach Kunde, Standort und Zustaendigkeit - geprueft ueber
 * die echte API und echte Socket.IO-Verbindungen. Laeuft als zweiter Teil
 * von tests/workflows.ts (gleicher Server, gleiche In-Memory-Datenbank).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { io, type Socket } from "socket.io-client";
import { addDate, berlinDate, isoWeek } from "../src/lib/berlin";

export type TestPerson = { id: string; email: string; memberId: string; firstName: string; lastName: string };
type SessionLike = { request(path: string, method?: string, data?: unknown, expected?: number): Promise<any>; login(email: string): Promise<void>; cookie(): string };
export type TestContext = {
  base: string;
  users: Record<string, TestPerson>;
  password: string;
  categoryId: string;
  check: (value: unknown, message: string) => void;
  Session: new () => SessionLike;
  counter: () => number;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function permissionTests(t: TestContext) {
  const { users, check } = t;
  const session = async (name: string) => { const s = new t.Session(); await s.login(users[name].email); return s; };
  const admin = await session("admin"), mA = await session("managerA"), mB = await session("managerB"), viewer = await session("viewer");
  const sA = await session("staffA"), sB = await session("staffB"), loner = await session("loner"), foreign = await session("foreign");

  async function waitFor(condition: () => boolean, message: string, timeout = 6000) {
    const start = Date.now();
    while (!condition() && Date.now() - start < timeout) await sleep(100);
    check(condition(), message);
  }
  async function connect(s: SessionLike): Promise<Socket> {
    const socket = io(t.base, { path: "/api/ws", transports: ["websocket"], extraHeaders: { Cookie: s.cookie() }, reconnection: false, forceNew: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Socket-Verbindung kam nicht zustande")), 10000);
      socket.once("connect", () => { clearTimeout(timer); resolve(); });
      socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
    });
    await sleep(800); // Raeume vergibt der Server nach dem Verbindungsaufbau.
    return socket;
  }

  // --- Struktur: Kunden und Standorte ------------------------------------
  const customer = async (name: string) => (await admin.request("/api/customers", "POST", { name })).customer;
  const k1 = await customer("Kunde Eins"), k2 = await customer("Kunde Zwei");
  await mA.request("/api/customers", "POST", { name: "Darf nicht" }, 403);
  const branch = async (customerId: string, name: string) => (await admin.request("/api/branches", "POST", { customerId, name })).branch;
  const b1 = await branch(k1.id, "Standort Eins"), b2 = await branch(k2.id, "Standort Zwei"), b3 = await branch(k1.id, "Standort Monat");
  await mA.request("/api/branches", "POST", { customerId: k1.id, name: "Darf nicht" }, 403);
  const foreignCustomer = (await foreign.request("/api/customers", "POST", { name: "Fremdkunde" })).customer;
  const foreignBranch = (await foreign.request("/api/branches", "POST", { customerId: foreignCustomer.id, name: "Fremdobjekt" })).branch;
  await admin.request("/api/branches", "POST", { customerId: foreignCustomer.id, name: "Mischung" }, 404);
  await admin.request("/api/branches", "PATCH", { id: b1.id, customerId: foreignCustomer.id }, 404);

  // --- Freigaben ---------------------------------------------------------
  const grant = (member: string, branchId: string, rights: string[], expected = 200) => admin.request("/api/employees/" + member + "/access", "PUT", { kind: "branch", branchId, rights }, expected);
  const staff = (manager: string, employee: string, rights: string[], expected = 200) => admin.request("/api/employees/" + manager + "/access", "PUT", { kind: "staff", memberId: employee, rights }, expected);
  await grant(users.managerA.memberId, b1.id, ["EDIT_SHIFTS", "PUBLISH_SCHEDULE", "HANDLE_REQUESTS", "VIEW_TIME", "EDIT_TIME", "MANAGE_ISSUES"]);
  await staff(users.managerA.memberId, users.staffA.memberId, ["ASSIGN_SHIFTS", "VIEW_PROFILE", "MANAGE_ABSENCES", "VIEW_HOURS"]);
  await grant(users.managerB.memberId, b2.id, ["EDIT_SHIFTS", "PUBLISH_SCHEDULE"]);
  await staff(users.managerB.memberId, users.staffB.memberId, ["ASSIGN_SHIFTS"]);
  await grant(users.viewer.memberId, b1.id, ["VIEW_SCHEDULE"]);
  await grant(users.loner.memberId, b1.id, ["EDIT_SHIFTS"], 400);
  await staff(users.loner.memberId, users.staffA.memberId, ["VIEW_PROFILE"], 400);
  await staff(users.managerA.memberId, users.admin.memberId, ["VIEW_PROFILE"], 400);
  await mA.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "branch", branchId: b2.id, rights: ["VIEW_SCHEDULE"] }, 403);
  await mA.request("/api/employees/" + users.managerA.memberId + "/access", "GET", undefined, 403);
  const aAccess = await admin.request("/api/employees/" + users.managerA.memberId + "/access");
  check(aAccess.grants.find((g: any) => g.branchId === b1.id).rights.includes("VIEW_SCHEDULE"), "editing a plan implies viewing it");
  check(aAccess.staff.find((s: any) => s.memberId === users.staffA.memberId).rights.length === 4, "staff rights stored individually");
  check((await admin.request("/api/employees/" + users.staffA.memberId + "/access")).managers.some((m: any) => m.memberId === users.managerA.memberId), "employee access shows the responsible managers");

  // --- Admin sieht alles, Manager nur Freigegebenes -----------------------
  const all = await admin.request("/api/customers");
  check([b1, b2, b3].every((b) => all.customers.some((c: any) => c.branches.some((x: any) => x.id === b.id))), "admin sees all customers and locations");
  const adminHome = await admin.request("/api/dashboard");
  check([b1, b2, b3].every((b) => adminHome.overview.customers.some((c: any) => c.branches.some((x: any) => x.id === b.id))), "admin start page shows all locations");
  const aCustomers = await mA.request("/api/customers");
  check(aCustomers.customers.length === 1 && aCustomers.customers[0].id === k1.id && aCustomers.customers[0].branches.map((b: any) => b.id).join() === b1.id && !("notes" in aCustomers.customers[0]), "manager A sees only the granted customer and location");
  check((await mA.request("/api/branches")).branches.map((b: any) => b.id).join() === b1.id, "manager A location list is scoped");
  const aHome = await mA.request("/api/dashboard");
  check(aHome.overview.customers.length === 1 && aHome.overview.customers[0].branches.map((b: any) => b.id).join() === b1.id && aHome.overview.legacyShifts === null, "manager A start page shows only the granted location");
  check(typeof aHome.counts.pendingRequests === "number" && typeof aHome.counts.pendingAbsences === "number" && typeof aHome.counts.openIssues === "number", "start page counts what manager A is responsible for");
  const bHome = await mB.request("/api/dashboard");
  check(bHome.counts.pendingRequests === null && bHome.counts.pendingAbsences === null && bHome.counts.pendingCorrections === null && bHome.counts.openIssues === null, "start page shows no counters without the matching right");

  // --- Planen: A an Standort Eins, B an Standort Zwei ---------------------
  const day = addDate(berlinDate(), 4), week = isoWeek(day), dow = ((new Date(day).getUTCDay() + 6) % 7) + 1;
  const weekPath = "/api/schedules?kw=" + week.weekNumber + "&year=" + week.year;
  const plan = (b: { id: string }) => weekPath + "&standort=" + b.id;
  const planA = (await mA.request(plan(b1))).schedule;
  await mA.request(plan(b2), "GET", undefined, 404);
  const planB = (await mB.request(plan(b2))).schedule;
  const shiftA = (await mA.request("/api/shifts", "POST", { scheduleId: planA.id, dayOfWeek: dow, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 2, title: "Tagdienst" })).shifts[0];
  const shiftB = (await mB.request("/api/shifts", "POST", { scheduleId: planB.id, dayOfWeek: dow, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 1, title: "Tagdienst" })).shifts[0];
  // Fremder Standort: weder ueber IDs noch ueber den Anfragekoerper erreichbar.
  await mA.request("/api/shifts", "POST", { scheduleId: planB.id, dayOfWeek: dow, shiftFrom: "09:00", shiftTo: "10:00", maxEmployees: 1 }, 404);
  await mA.request("/api/shifts/" + shiftB.id, "PATCH", { title: "Fremd" }, 404);
  await mA.request("/api/shifts/" + shiftB.id, "DELETE", undefined, 404);
  await mA.request("/api/shifts/" + shiftB.id + "/places", "POST", undefined, 404);
  await mA.request("/api/shifts/" + shiftB.id + "/candidates", "GET", undefined, 404);
  await mA.request("/api/shifts/" + shiftB.id + "/copy", "POST", { date: day }, 404);
  await mA.request("/api/bookings", "POST", { shiftId: shiftB.id, userId: users.staffA.id }, 404);
  await mA.request("/api/schedules/" + planB.id, "PATCH", { isPublic: true }, 404);
  await mA.request("/api/schedules/" + planB.id + "/briefing", "GET", undefined, 404);
  await mA.request("/api/live?scheduleId=" + planB.id, "GET", undefined, 404);
  await mA.request("/api/branches/" + b2.id + "/month", "GET", undefined, 404);
  await mA.request("/api/branches/" + b2.id + "/issues", "GET", undefined, 404);
  await mA.request("/api/shifts/" + shiftA.id, "PATCH", { branchId: b2.id }, 404);
  await mA.request("/api/shifts/" + shiftA.id, "PATCH", { branchId: foreignBranch.id }, 404);
  await admin.request("/api/shifts/" + shiftA.id, "PATCH", { branchId: foreignBranch.id }, 404);
  await admin.request("/api/shifts", "POST", { scheduleId: planA.id, branchId: b2.id, dayOfWeek: dow, shiftFrom: "09:00", shiftTo: "10:00", maxEmployees: 1 }, 400);
  const merged = await mA.request(weekPath);
  check(merged.schedule.shifts.some((s: any) => s.id === shiftA.id) && merged.schedule.shifts.every((s: any) => s.branchId === b1.id), "manager A week view shows only the granted location");

  // --- Besetzen nur mit Personalzuordnung "Einplanen" ---------------------
  const candidates = (await mA.request("/api/shifts/" + shiftA.id + "/candidates")).members.map((m: any) => m.userId);
  check(candidates.includes(users.staffA.id) && !candidates.includes(users.staffB.id) && !candidates.includes(users.loner.id), "candidates limited to explicitly assigned staff");
  await mA.request("/api/bookings", "POST", { shiftId: shiftA.id, userId: users.staffB.id }, 403);
  await mA.request("/api/bookings", "POST", { shiftId: shiftA.id, userId: users.staffA.id });
  await mB.request("/api/bookings", "POST", { shiftId: shiftB.id, userId: users.staffB.id });
  await mA.request("/api/schedules/" + planA.id, "PATCH", { isPublic: true });
  await mB.request("/api/schedules/" + planB.id, "PATCH", { isPublic: true });

  // --- "Plan ansehen" erlaubt keine Bearbeitung und keine Personaldaten ---
  const viewerPlan = await viewer.request(plan(b1));
  check(viewerPlan.access.view && !viewerPlan.access.edit && !viewerPlan.access.publish && !viewerPlan.access.viewTime && viewerPlan.schedule.shifts.some((s: any) => s.id === shiftA.id && s.bookings.some((b: any) => b.userId === users.staffA.id)), "view right shows names in the plan, nothing to edit");
  await viewer.request("/api/shifts", "POST", { scheduleId: planA.id, dayOfWeek: dow, shiftFrom: "09:00", shiftTo: "10:00", maxEmployees: 1 }, 403);
  await viewer.request("/api/shifts/" + shiftA.id, "PATCH", { title: "Ansicht" }, 403);
  await viewer.request("/api/schedules/" + planA.id, "PATCH", { isPublic: false }, 403);
  await viewer.request("/api/bookings", "DELETE", { shiftId: shiftA.id, userId: users.staffA.id }, 403);
  await viewer.request("/api/shifts/" + shiftA.id + "/candidates", "GET", undefined, 403);
  await viewer.request("/api/employees/" + users.staffA.memberId, "GET", undefined, 404);
  await viewer.request("/api/employees/" + users.staffA.memberId + "/notes", "GET", undefined, 404);
  check((await viewer.request("/api/employees")).members.length === 0, "plan right gives no staff list");

  // --- "Plan bearbeiten" erlaubt nicht automatisch Personalverwaltung -----
  await mB.request("/api/employees/" + users.staffB.memberId, "GET", undefined, 404);
  const bList = await mB.request("/api/employees");
  check(bList.members.length === 1 && bList.members[0].user.email === null && bList.members[0].user.phone === null, "planning staff without profile right shows no contact data");

  // --- Manager A: Personaldaten nur fuer zugeordnete Personen -------------
  const profile = await mA.request("/api/employees/" + users.staffA.memberId);
  check(profile.user.email === users.staffA.email && !profile.permissions.editPersonnel && !profile.permissions.admin, "manager A sees the assigned profile without edit rights");
  check(profile.targetHoursPerWeek === null && profile.employmentType === null && !("activationToken" in profile), "profile right shows no contract data");
  await mA.request("/api/employees/" + users.staffA.memberId, "PATCH", { targetHoursPerWeek: 10 }, 403);
  await mA.request("/api/employees/" + users.staffA.memberId, "PATCH", { email: "neu@akro-test.invalid" }, 403);
  await mA.request("/api/employees/" + users.staffB.memberId, "GET", undefined, 404);
  await mA.request("/api/employees/" + users.loner.memberId, "GET", undefined, 404);
  await mA.request("/api/employees/" + users.staffB.memberId + "/notes", "POST", { text: "Fremd" }, 404);
  check((await mA.request("/api/employees?search=Zweier")).members.length === 0, "search does not reveal unassigned people");
  check((await mA.request("/api/employees?search=staffb")).members.length === 0, "search does not match hidden e-mail addresses");
  check((await mA.request("/api/employees?search=Einser")).members.length === 1, "search finds assigned staff");

  // --- Abwesenheiten -----------------------------------------------------
  const absA = (await sA.request("/api/absences", "POST", { userId: users.staffA.id, categoryId: t.categoryId, dateFrom: addDate(day, 10), dateTo: addDate(day, 11) }, 201)).absence;
  const absB = (await sB.request("/api/absences", "POST", { userId: users.staffB.id, categoryId: t.categoryId, dateFrom: addDate(day, 10), dateTo: addDate(day, 11) }, 201)).absence;
  const aAbs = await mA.request("/api/absences");
  check(aAbs.absences.some((x: any) => x.id === absA.id) && !aAbs.absences.some((x: any) => x.id === absB.id), "manager A sees absences only of assigned staff with the right");
  check(aAbs.absences.find((x: any) => x.id === absA.id).canDecide === true && !aAbs.people.some((p: any) => p.userId === users.staffB.id), "absence decisions and person choice follow the staff right");
  check((await sA.request("/api/absences")).absences.every((x: any) => x.canDecide === false), "employees cannot decide their own absences");
  await mA.request("/api/absences/" + absB.id, "PATCH", { status: "APPROVED" }, 404);
  await mA.request("/api/absences/" + absA.id, "PATCH", { status: "APPROVED" });
  await mA.request("/api/absences", "POST", { userId: users.staffB.id, categoryId: t.categoryId, dateFrom: addDate(day, 20), dateTo: addDate(day, 20) }, 404);
  check(!(await mB.request("/api/absences")).absences.some((x: any) => x.userId === users.staffB.id), "planning a person does not reveal their absences");
  const aInbox = await mA.request("/api/messages");
  const bInbox = await mB.request("/api/messages");
  check(aInbox.messages.some((m: any) => m.subject === "Neuer Abwesenheitsantrag") && !bInbox.messages.some((m: any) => m.subject === "Neuer Abwesenheitsantrag"), "absence requests notify only responsible managers");

  // --- Stunden: Standortrecht UND Personalrecht ---------------------------
  const month = day.slice(0, 7), period = "month=" + Number(month.slice(5)) + "&year=" + month.slice(0, 4);
  const tA = (await sA.request("/api/time", "POST", { type: "MANUAL", userId: users.staffA.id, date: day, timeFrom: "08:00", timeTo: "16:00" }, 201)).record;
  const tB = (await sB.request("/api/time", "POST", { type: "MANUAL", userId: users.staffB.id, date: day, timeFrom: "08:00", timeTo: "16:00" }, 201)).record;
  const tLoose = (await sA.request("/api/time", "POST", { type: "MANUAL", userId: users.staffA.id, date: addDate(day, 1), timeFrom: "08:00", timeTo: "09:00" }, 201)).record;
  check(tA.branchId === b1.id && tB.branchId === b2.id, "time records get the location of the overlapping published shift");
  check(tLoose.branchId === null, "record without matching shift stays unassigned");
  await sA.request("/api/time", "POST", { type: "MANUAL", userId: users.staffA.id, date: day, timeFrom: "08:00", timeTo: "09:00", branchId: b2.id }, 400);
  await mA.request("/api/time", "POST", { type: "MANUAL", userId: users.staffB.id, date: day, timeFrom: "08:00", timeTo: "09:00" }, 404);
  const aRecords = (await mA.request("/api/time?month=" + month)).employees.flatMap((e: any) => e.records.map((r: any) => r.id));
  check(aRecords.includes(tA.id) && !aRecords.includes(tB.id) && !aRecords.includes(tLoose.id), "manager A sees hours only at the granted location for assigned staff");
  check((await admin.request("/api/time?month=" + month)).employees.some((e: any) => e.records.some((r: any) => r.id === tLoose.id)), "unassigned records stay visible to the administration");
  check(!(await mB.request("/api/time?month=" + month)).employees.flatMap((e: any) => e.records).some((r: any) => r.id === tB.id), "planning right alone shows no hours");
  const aCsv: string = await mA.request("/api/reporting/export?" + period);
  check(aCsv.includes("Einser") && !aCsv.includes("Zweier") && !aCsv.includes("Dreier") && !aCsv.includes("Blick"), "export contains only assigned staff");
  const aReport = await mA.request("/api/reporting?" + period);
  check(aReport.employees.find((e: any) => e.userId === users.staffA.id)?.targetMinutes === null && !aReport.employees.some((e: any) => e.userId === users.staffB.id), "report scoped; target hours of others stay with the administration");
  await mA.request("/api/reporting?" + period + "&standort=" + b2.id, "GET", undefined, 404);
  check((await mB.request("/api/reporting/export?" + period)).split("\r\n").length === 2, "manager without time rights exports only the own row");
  const corrA = (await sA.request("/api/time/" + tA.id, "PATCH", { timeTo: "16:30", reason: "Übergabe dauerte länger" })).correction;
  const corrB = (await sB.request("/api/time/" + tB.id, "PATCH", { timeTo: "16:30", reason: "Übergabe dauerte länger" })).correction;
  await mA.request("/api/time/corrections", "PATCH", { id: corrB.id, status: "APPROVED" }, 404);
  check(!(await mA.request("/api/time/corrections")).corrections.some((c: any) => c.id === corrB.id), "foreign corrections are not listed");
  await mA.request("/api/time/corrections", "PATCH", { id: corrA.id, status: "APPROVED" });

  // --- Benachrichtigungen und Nachrichten ---------------------------------
  const sBInbox = await sB.request("/api/messages");
  const published = sBInbox.messages.find((m: any) => m.subject === "Dienstplan veröffentlicht");
  check(published && !aInbox.messages.some((m: any) => m.body.includes("Standort Zwei")), "publication notifies only people at that location");
  const publishedDetail = await sB.request("/api/messages/" + published.id);
  check(publishedDetail.message.recipients.every((r: any) => r.userId === users.staffB.id) && publishedDetail.message.hiddenRecipients === 0, "notifications do not reveal other recipients");
  const aRecipients = (await mA.request("/api/messages/recipients")).recipients.map((r: any) => r.id);
  check(aRecipients.includes(users.staffA.id) && aRecipients.includes(users.admin.id) && !aRecipients.includes(users.staffB.id) && !aRecipients.includes(users.loner.id), "manager A can write to assigned staff and the administration only");
  await mA.request("/api/messages", "POST", { subject: "Frage", body: "Test", recipientIds: [users.staffB.id] }, 403);
  const group = (await admin.request("/api/messages", "POST", { subject: "Rundschreiben", body: "Info", recipientIds: [users.staffA.id, users.staffB.id, users.loner.id] }, 201)).message;
  const groupView = await sA.request("/api/messages/" + group.id);
  check(groupView.message.recipients.every((r: any) => r.userId === users.staffA.id) && groupView.message.hiddenRecipients === 2, "co-recipients stay hidden from employees");
  const reply = (await sA.request("/api/messages/" + group.id + "/reply", "POST", { body: "Gelesen" }, 201)).message;
  check(!(await sB.request("/api/messages")).messages.some((m: any) => m.id === reply.id), "replies do not reach hidden co-recipients");
  check((await admin.request("/api/messages")).messages.some((m: any) => m.id === reply.id), "replies reach the sender");

  // --- Standortmeldungen --------------------------------------------------
  const issue = (await mA.request("/api/branches/" + b1.id + "/issues", "POST", { title: "Tor klemmt", description: "Zufahrt Nord schließt nicht.", assigneeMemberId: users.managerA.memberId }, 201)).issue;
  check(issue.status === "OPEN" && issue.assignee.id === users.managerA.memberId && issue.createdAt, "issue has description, status, responsible person and timestamp");
  await mA.request("/api/branches/" + b1.id + "/issues", "POST", { title: "x", description: "y", assigneeMemberId: users.managerB.memberId }, 400);
  await mB.request("/api/branches/" + b1.id + "/issues", "GET", undefined, 404);
  await viewer.request("/api/branches/" + b1.id + "/issues", "GET", undefined, 403);
  await sA.request("/api/branches/" + b1.id + "/issues", "GET", undefined, 404);
  await loner.request("/api/issues/" + issue.id, "PATCH", { status: "RESOLVED" }, 404);
  const cardsBefore = (await admin.request("/api/dashboard")).overview.customers.flatMap((c: any) => c.branches).find((b: any) => b.id === b1.id);
  check(cardsBefore.issuesOpen === 1 && typeof cardsBefore.openSlots === "number", "location card counts issues separately from open places");
  check((await viewer.request("/api/dashboard")).overview.customers.flatMap((c: any) => c.branches).find((b: any) => b.id === b1.id).issuesOpen === null, "issues stay hidden without the right");
  const resolved = (await mA.request("/api/issues/" + issue.id, "PATCH", { status: "RESOLVED" })).issue;
  check(resolved.status === "RESOLVED" && resolved.resolvedAt, "resolving an issue records the time");

  // --- Mitarbeitende ohne Freigabe ----------------------------------------
  check((await loner.request(weekPath)).schedule.shifts.length === 0, "employee without grant sees no foreign shifts");
  await loner.request(plan(b1), "GET", undefined, 404);
  await loner.request("/api/branches/" + b1.id + "/month", "GET", undefined, 404);
  check((await loner.request("/api/branches")).branches.length === 0 && (await loner.request("/api/customers")).customers.length === 0, "employee without grant sees no customers or locations");
  await loner.request("/api/employees", "GET", undefined, 403);
  await loner.request("/api/employees/" + users.staffA.memberId, "GET", undefined, 404);
  check((await loner.request("/api/absences")).absences.every((x: any) => x.userId === users.loner.id), "employee sees no foreign absences");
  check((await loner.request("/api/time?month=" + month)).employees.every((e: any) => e.userId === users.loner.id), "employee sees no foreign hours");
  check((await loner.request("/api/availability")).availabilities.every((x: any) => x.userId === users.loner.id), "employee sees no foreign availability");
  const lonerRecipients = (await loner.request("/api/messages/recipients")).recipients.map((r: any) => r.id);
  check(lonerRecipients.includes(users.admin.id) && !lonerRecipients.includes(users.staffA.id) && !lonerRecipients.includes(users.managerA.id), "employee without grants can only write to the administration");
  await loner.request("/api/messages", "POST", { subject: "Hallo", body: "Test", recipientIds: [users.staffA.id] }, 403);
  check((await loner.request("/api/mod-requests")).requests.length === 0, "employee sees no foreign requests");
  const lonerHome = await loner.request("/api/dashboard");
  check(!lonerHome.manager && lonerHome.open.length === 0 && lonerHome.plans.length === 0, "employee home shows no open shifts or plans without grants");

  // --- Freigabe und Entzug wirken sofort (Mitarbeitende) ------------------
  await grant(users.loner.memberId, b1.id, ["REQUEST_SHIFTS"]);
  const withGrant = await loner.request("/api/dashboard");
  check(withGrant.open.some((s: any) => s.id === shiftA.id) && withGrant.open.every((s: any) => s.bookings.length === 0), "open-shift grant shows open places without names");
  check((await loner.request(weekPath)).schedule.shifts.some((s: any) => s.id === shiftA.id && s.bookings.length === 0 && s.occupiedCount === 1), "week view shows open places without foreign names");
  await grant(users.loner.memberId, b1.id, ["VIEW_SCHEDULE"]);
  check((await loner.request(plan(b1))).schedule.shifts.some((s: any) => s.id === shiftA.id && s.bookings.some((b: any) => b.userId === users.staffA.id && b.confirmedAt === null && !("unavailable" in b))), "full plan grant shows names, but no planning details");
  await loner.request("/api/employees/" + users.staffA.memberId, "GET", undefined, 404);
  check(!(await loner.request("/api/absences")).absences.some((x: any) => x.userId === users.staffA.id), "plan grant does not reveal absences");
  await grant(users.loner.memberId, b1.id, []);
  await loner.request(plan(b1), "GET", undefined, 404);
  check((await loner.request("/api/dashboard")).open.length === 0, "revoked grant hides open shifts immediately");
  await loner.request("/api/mod-requests", "POST", { shiftId: shiftA.id }, 404);

  // --- Monatsplan: Besetzung, Entwurf, Monats- und Jahreswechsel ----------
  // KW 53/2026 reicht vom 28.12.2026 bis 03.01.2027.
  const planDec = (await admin.request("/api/schedules?kw=53&year=2026&standort=" + b3.id)).schedule;
  const night = (await admin.request("/api/shifts", "POST", { scheduleId: planDec.id, dayOfWeek: 4, shiftFrom: "22:00", shiftTo: "06:00", maxEmployees: 2, title: "Silvester" })).shifts[0];
  const newYear = (await admin.request("/api/shifts", "POST", { scheduleId: planDec.id, dayOfWeek: 5, shiftFrom: "08:00", shiftTo: "16:00", maxEmployees: 1, title: "Neujahr" })).shifts[0];
  check(night.date === "2026-12-31" && newYear.date === "2027-01-01", "ISO week 53 dates across the year change");
  await admin.request("/api/bookings", "POST", { shiftId: night.id, userId: users.employee.id });
  await admin.request("/api/bookings", "POST", { shiftId: newYear.id, userId: users.replacement.id });
  const dec = await admin.request("/api/branches/" + b3.id + "/month?monat=2026-12");
  const d31 = dec.days.find((d: any) => d.date === "2026-12-31");
  check(dec.days.length === 31 && d31.shifts.some((s: any) => s.id === night.id && s.endsNextDay && s.missing === 1 && !s.isPublic), "December: night shift on the 31st, one place missing, draft marked");
  check(!dec.days.some((d: any) => d.shifts.some((s: any) => s.id === newYear.id)) && dec.totals.missing === 1 && dec.totals.draftShifts === 1, "December excludes January shifts of the same week");
  const jan = await admin.request("/api/branches/" + b3.id + "/month?monat=2027-01");
  check(jan.days[0].date === "2027-01-01" && jan.days[0].shifts.some((s: any) => s.id === newYear.id && s.missing === 0) && jan.days[0].continuations.some((s: any) => s.id === night.id), "January: full New Year shift, night shift continues from December");
  check(jan.totals.missing === 0 && jan.totals.shifts === 1, "full shift has no missing places; continuation not counted twice");
  await admin.request("/api/absences", "POST", { userId: users.replacement.id, categoryId: t.categoryId, dateFrom: "2027-01-01", dateTo: "2027-01-01", status: "APPROVED" }, 201);
  const janAbsent = await admin.request("/api/branches/" + b3.id + "/month?monat=2027-01");
  const newYearView = janAbsent.days[0].shifts.find((s: any) => s.id === newYear.id);
  check(newYearView.missing === 1 && newYearView.bookings[0].unavailable === true, "only effective assignments count: absent person leaves the place open");
  await grant(users.staffB.memberId, b3.id, ["VIEW_SCHEDULE"]);
  check((await sB.request("/api/branches/" + b3.id + "/month?monat=2026-12")).totals.shifts === 0, "employees do not see drafts");
  await admin.request("/api/schedules/" + planDec.id, "PATCH", { isPublic: true });
  const pub = await sB.request("/api/branches/" + b3.id + "/month?monat=2026-12");
  const pubNight = pub.days.find((d: any) => d.date === "2026-12-31").shifts[0];
  check(pub.totals.shifts === 1 && pubNight.missing === 1 && pubNight.isPublic && !("unavailable" in pubNight.bookings[0]), "published plan visible to granted employee without planning details");
  const empty = await admin.request("/api/branches/" + b3.id + "/month?monat=2027-03");
  check(empty.totals.shifts === 0 && empty.days.length === 31 && empty.days.every((d: any) => d.shifts.length === 0), "month without shifts has a complete, empty calendar");

  // --- Fremde Organisation -------------------------------------------------
  await foreign.request("/api/branches/" + b1.id + "/month", "GET", undefined, 404);
  await foreign.request(plan(b1), "GET", undefined, 404);
  await foreign.request("/api/employees/" + users.staffA.memberId + "/access", "GET", undefined, 404);
  await foreign.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "branch", branchId: foreignBranch.id, rights: ["VIEW_SCHEDULE"] }, 404);
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "branch", branchId: foreignBranch.id, rights: ["VIEW_SCHEDULE"] }, 404);
  await admin.request("/api/employees/" + users.managerA.memberId + "/access", "PUT", { kind: "staff", memberId: users.foreign.memberId, rights: ["VIEW_PROFILE"] }, 404);
  await foreign.request("/api/issues/" + issue.id, "PATCH", { status: "OPEN" }, 404);

  // --- Entzug beim Manager: API, Export, Nachrichten und Echtzeit ---------
  const socket = await connect(mA);
  const signals: unknown[] = [];
  socket.on("schedule:updated", (payload) => signals.push(payload));
  await admin.request("/api/shifts/" + shiftA.id + "/places", "POST");
  await waitFor(() => signals.length > 0, "manager A receives real-time signals for the granted location");
  check(signals.every((p) => JSON.stringify(p) === "{}"), "real-time signals carry no content");
  signals.length = 0;
  await admin.request("/api/shifts/" + shiftB.id + "/places", "POST");
  await sleep(1200);
  check(signals.length === 0, "no real-time signal from a foreign location");
  check((await mA.request("/api/time/corrections")).corrections.some((c: any) => c.id === corrA.id), "manager A sees corrections of assigned staff");
  await staff(users.managerA.memberId, users.staffA.memberId, []);
  await mA.request("/api/employees/" + users.staffA.memberId, "GET", undefined, 404);
  check(!(await mA.request("/api/time/corrections")).corrections.some((c: any) => c.id === corrA.id), "revoked staff assignment hides time corrections immediately");
  check(!(await mA.request("/api/reporting/export?" + period)).includes("Einser"), "revoked staff assignment removes hours from the export immediately");
  check(!(await mA.request("/api/absences")).absences.some((x: any) => x.userId === users.staffA.id), "revoked staff assignment hides absences immediately");
  await grant(users.managerA.memberId, b1.id, []);
  await mA.request(plan(b1), "GET", undefined, 404);
  await mA.request("/api/shifts/" + shiftA.id, "PATCH", { title: "Nach Entzug" }, 404);
  await mA.request("/api/branches/" + b1.id + "/issues", "GET", undefined, 404);
  check((await mA.request("/api/customers")).customers.length === 0, "revoked grant removes the customer card");
  const revokedHome = await mA.request("/api/dashboard");
  check(revokedHome.overview.customers.length === 0 && revokedHome.counts.openSlots === null && revokedHome.counts.openIssues === null, "revoked grant removes location cards and counters from the start page");
  check(!(await mA.request("/api/messages/recipients")).recipients.some((r: any) => r.id === users.staffA.id), "revoked grants remove message recipients");
  await mA.request("/api/messages", "POST", { subject: "Nach Entzug", body: "Test", recipientIds: [users.staffA.id] }, 403);
  signals.length = 0;
  await admin.request("/api/shifts/" + shiftA.id + "/places", "DELETE");
  await sleep(1200);
  check(signals.length === 0 && socket.connected, "revoked grant stops real-time signals immediately, connection stays for own events");
  socket.disconnect();

  // Deaktivierung trennt offene Verbindungen und sperrt die naechste Anfrage.
  const viewerSocket = await connect(viewer);
  await admin.request("/api/employees/" + users.viewer.memberId, "DELETE");
  await waitFor(() => viewerSocket.disconnected, "deactivation closes open real-time connections");
  await viewer.request("/api/me", "GET", undefined, 401);
  viewerSocket.close();
  console.log("PERMISSIONS: " + t.counter() + " checks so far.");
}
