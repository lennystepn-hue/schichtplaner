/* Integration tests use a separate in-memory PostgreSQL engine, never .env data. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { berlinDate, berlinTime, addDate, isoWeek, weekDate, recordMinutes } from "../src/lib/berlin";
import { permissionTests, type TestContext, type TestPerson } from "./permissions";

async function main() {
const sql = new PGlite();
const migrations = (await readdir("prisma/migrations")).filter(x => /^\d/.test(x)).sort();
for (const migration of migrations) await sql.exec(await readFile("prisma/migrations/" + migration + "/migration.sql", "utf8"));
console.log("PASS: all migrations on PostgreSQL");
const socket = new PGLiteSocketServer({ db: sql, host: "127.0.0.1", port: 55439 });
await socket.start();
const url = "postgresql://postgres:postgres@127.0.0.1:55439/postgres";
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
const password = "AkroTest2026!Only";
const passwordHash = await bcrypt.hash(password, 10);
const org = await client.organization.create({ data: { name: "AKRO Integrationstest" } });
const other = await client.organization.create({ data: { name: "Andere Organisation" } });
const users: Record<string, TestPerson> = {};
const people = [
  ["admin", "ADMIN", org.id, "Alex", "Test"], ["employee", "EMPLOYEE", org.id, "Mara", "Test"], ["replacement", "EMPLOYEE", org.id, "Jonas", "Test"], ["foreign", "ADMIN", other.id, "Extern", "Test"],
  // Fuer die Berechtigungsreihe (tests/permissions.ts)
  ["managerA", "MANAGER", org.id, "Anna", "Nordplan"], ["managerB", "MANAGER", org.id, "Bernd", "Suedplan"], ["viewer", "MANAGER", org.id, "Vera", "Blick"],
  ["staffA", "EMPLOYEE", org.id, "Emil", "Einser"], ["staffB", "EMPLOYEE", org.id, "Elke", "Zweier"], ["loner", "EMPLOYEE", org.id, "Edda", "Dreier"],
] as const;
for (const [name, role, organizationId, firstName, lastName] of people) {
  const user = await client.user.create({ data: { firstName, lastName, email: name.toLowerCase() + "@akro-test.invalid", passwordHash } });
  const m = await client.organizationMember.create({ data: { userId: user.id, organizationId, role, isActivated: true, position: "Sicherheit", qualifications: ["Erste Hilfe"] } });
  users[name] = { id: user.id, email: user.email, memberId: m.id, firstName, lastName };
}
const category = await client.absenceCategory.create({ data: { organizationId: org.id, name: "Urlaub" } });
const foreignCategory = await client.timeCategory.create({ data: { organizationId: other.id, name: "Privat" } });
await client.$disconnect();

const port = Number(process.env.TEST_PORT || 3305);
const base = "http://127.0.0.1:" + port;
// Der eigene Server (server.ts) statt "next dev": nur so laufen Socket.IO und
// die Echtzeit-Rechtepruefung mit.
const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server.ts"], {
  cwd: process.cwd(), windowsHide: true, env: { ...process.env, NODE_ENV: "development", NEXT_DEV_WEBPACK: "1", PORT: String(port), DATABASE_URL: url, DATABASE_POOL_MAX: "1", AUTH_SECRET: "integration-test-secret-only-0123456789abcdef", AUTH_TRUST_HOST: "true", AUTH_URL: base, APP_URL: base, AI_ENABLED: "false", ALLOW_REGISTRATION: "false", NEXT_TELEMETRY_DISABLED: "1", TZ: "Europe/Berlin" },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
child.stdout.on("data", chunk => { serverLog = (serverLog + chunk).slice(-18000); });
child.stderr.on("data", chunk => { serverLog = (serverLog + chunk).slice(-18000); });
let checks = 0;
function check(value: unknown, message: string) { assert.ok(value, message); checks++; console.log("PASS: " + message); }
class Session {
  jar = new Map<string,string>();
  cookie() { return [...this.jar].map(([k,v]) => k + "=" + v).join("; "); }
  async request(path: string, method = "GET", data?: unknown, expected = 200): Promise<any> {
    const res = await fetch(base + path, { method, redirect: "manual", headers: { Cookie: this.cookie(), "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    for (const cookie of res.headers.getSetCookie()) { const pair = cookie.split(";")[0], index = pair.indexOf("="); this.jar.set(pair.slice(0,index), pair.slice(index+1)); }
    const text = await res.text();
    assert.equal(res.status, expected, method + " " + path + ": " + text.slice(0,500));
    checks++;
    if (res.headers.get("content-type")?.includes("json")) return JSON.parse(text);
    return text;
  }
  async login(email: string) {
    const csrf = await this.request("/api/auth/csrf");
    const res = await fetch(base + "/api/auth/callback/credentials", { method: "POST", redirect: "manual", headers: { Cookie: this.cookie(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password, callbackUrl: base + "/dashboard" }) });
    for (const cookie of res.headers.getSetCookie()) { const pair=cookie.split(";")[0], i=pair.indexOf("="); this.jar.set(pair.slice(0,i),pair.slice(i+1)); }
    const session = await this.request("/api/auth/session");
    check(session.user?.email === email, "credentials login " + email);
  }
  /** Anmeldung, die scheitern muss - etwa nach dem Deaktivieren. */
  async loginFails(email: string, message: string) {
    const csrf = await this.request("/api/auth/csrf");
    await fetch(base + "/api/auth/callback/credentials", { method: "POST", redirect: "manual", headers: { Cookie: this.cookie(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password, callbackUrl: base + "/dashboard" }) });
    // Ohne Sitzung liefert NextAuth null, nicht ein leeres Objekt.
    const session = await this.request("/api/auth/session");
    check(!session?.user, message);
  }
}
try {
  let ready = false;
  for (let i=0; i<180; i++) { try { if ((await fetch(base + "/api/health")).ok) { ready=true; break; } } catch {} await new Promise(r => setTimeout(r,500)); }
  check(ready, "server starts");
  check(berlinDate(new Date("2026-01-01T23:30:00Z")) === "2026-01-02", "Berlin date boundary");
  check(berlinTime(new Date("2026-07-01T10:00:00Z")) === "12:00", "Berlin summer time");
  check(weekDate(2026,1) === "2025-12-29" && isoWeek("2027-01-01").year === 2026, "ISO week/year transition");
  const admin = new Session(), employee = new Session(), replacement = new Session(), foreign = new Session(), anonymous = new Session();
  await admin.login(users.admin.email); await employee.login(users.employee.email); await replacement.login(users.replacement.email); await foreign.login(users.foreign.email);
  await anonymous.request("/api/branches", "GET", undefined, 307);
  await employee.request("/api/branches", "POST", { name: "Nicht erlaubt" }, 403);
  // Ein Standort gehoert immer zu einem Kunden derselben Organisation.
  const customer = (await admin.request("/api/customers", "POST", { name: "Kunde Nord" })).customer;
  await admin.request("/api/branches", "POST", { name: "Ohne Kunde" }, 400);
  const branch = (await admin.request("/api/branches", "POST", { customerId: customer.id, name: "Testobjekt Nord", address: "Teststraße 1", meetingPoint: "Pforte", positions: ["Sicherheit"], notes: "Beim Schichtleiter melden." })).branch;
  await foreign.request("/api/branches", "PATCH", { id: branch.id, name: "Fremdzugriff" }, 404);
  const today = berlinDate(), day = addDate(today, 2), week = isoWeek(day), dow = (new Date(day).getUTCDay()+6)%7+1;
  const weekPath = "/api/schedules?kw=" + week.weekNumber + "&year=" + week.year;
  const schedulePath = weekPath + "&standort=" + branch.id;
  const schedule = (await admin.request(schedulePath)).schedule;
  check(schedule.id && schedule.branchId === branch.id, "location plan created on demand for planners");
  const create = { scheduleId: schedule.id, branchId: branch.id, title: "Objektschutz", dayOfWeek: dow, shiftFrom: "22:00", shiftTo: "06:00", maxEmployees: 1, requiredQualifications: ["Erste Hilfe"], pauseOption: "PER_SHIFT", pauseValue: 30 };
  await employee.request("/api/shifts", "POST", create, 404);
  const shift = (await admin.request("/api/shifts", "POST", create)).shifts[0];
  check((await employee.request(weekPath)).schedule.shifts.length === 0, "draft hidden from employee");
  await employee.request(schedulePath, "GET", undefined, 404);
  await employee.request("/api/mod-requests", "POST", { shiftId: shift.id }, 404);
  await admin.request("/api/bookings", "POST", { shiftId: shift.id, userId: users.employee.id });
  await admin.request("/api/schedules/" + schedule.id, "PATCH", { isPublic: true });
  check((await employee.request(weekPath)).schedule.shifts.length > 0, "published own shift visible");
  await employee.request("/api/bookings", "PATCH", { shiftId: shift.id });
  check((await admin.request(schedulePath)).schedule.shifts[0].bookings[0].confirmedAt, "employee confirms own shift");
  await admin.request("/api/shifts/" + shift.id, "PATCH", { description: "Neuer Treffpunkt" });
  const changed = (await admin.request(schedulePath)).schedule.shifts[0];
  check(!changed.bookings[0].confirmedAt, "change invalidates confirmation");
  check(changed.pauseValue === 30 && changed.requiredQualifications.includes("Erste Hilfe"), "partial change keeps pause and qualifications");
  const conflict = (await admin.request("/api/shifts", "POST", { ...create, shiftFrom: "23:00", shiftTo: "04:00" })).shifts[0];
  await admin.request("/api/bookings", "POST", { shiftId: conflict.id, userId: users.employee.id }, 409);
  const window = (await replacement.request("/api/availability", "POST", { date: day, timeFrom: "21:00", timeTo: "07:00", available: false })).availability;
  check(!(await admin.request("/api/shifts/" + conflict.id + "/candidates")).members.some((m:any) => m.userId === users.replacement.id), "unavailable candidate excluded");
  await replacement.request("/api/availability", "DELETE", { id: window.id });
  const request = (await employee.request("/api/mod-requests", "POST", { shiftId: shift.id, kind: "SWAP" })).request;
  // Uebernehmen braucht eine Freigabe fuer offene Schichten an diesem Standort.
  await replacement.request("/api/mod-requests/" + request.id, "PATCH", { volunteer: true }, 404);
  await admin.request("/api/employees/" + users.replacement.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["REQUEST_SHIFTS"] });
  await replacement.request("/api/mod-requests/" + request.id, "PATCH", { volunteer: true });
  await employee.request("/api/mod-requests/" + request.id, "PATCH", { state: "ACCEPTED" }, 403);
  await admin.request("/api/mod-requests/" + request.id, "PATCH", { state: "ACCEPTED" });
  await admin.request("/api/mod-requests/" + request.id, "PATCH", { state: "ACCEPTED" }, 409);
  const swapped = (await admin.request(schedulePath)).schedule.shifts.find((s:any) => s.id === shift.id);
  check(swapped.bookings.length === 1 && swapped.bookings[0].userId === users.replacement.id, "swap replaces assignment atomically");
  await employee.request("/api/mod-requests", "POST", { shiftId: conflict.id }, 404);
  await admin.request("/api/employees/" + users.employee.memberId + "/access", "PUT", { kind: "branch", branchId: branch.id, rights: ["REQUEST_SHIFTS"] });
  const takeover = (await employee.request("/api/mod-requests", "POST", { shiftId: conflict.id })).request;
  await admin.request("/api/mod-requests/" + takeover.id, "PATCH", { state: "ACCEPTED" });
  await foreign.request("/api/mod-requests/" + takeover.id, "PATCH", { state: "DECLINED" }, 404);
  check((await foreign.request("/api/mod-requests?scheduleId=" + schedule.id)).requests.length === 0, "requests isolated by organization");
  const absence = (await employee.request("/api/absences", "POST", { userId: users.employee.id, categoryId: category.id, dateFrom: addDate(day,1), dateTo: addDate(day,2) }, 201)).absence;
  await employee.request("/api/absences/" + absence.id, "PATCH", { status: "APPROVED" }, 403);
  await admin.request("/api/absences/" + absence.id, "PATCH", { status: "APPROVED" });
  const copied = (await admin.request("/api/shifts/" + shift.id + "/copy", "POST", { date: addDate(day,1) })).shifts[0];
  check(copied.branchId === branch.id, "copy stays at the location");
  await admin.request("/api/bookings", "POST", { shiftId: copied.id, userId: users.employee.id }, 409);
  const series = await admin.request("/api/shifts", "POST", { ...create, repeatWeeks: 2, requiredQualifications: ["Brandschutz"] });
  check(series.shifts.length === 2 && series.shifts[0].scheduleId !== series.shifts[1].scheduleId && series.shifts.every((s:any) => s.branchId === branch.id), "weekly recurring shifts persisted per location plan");
  await admin.request("/api/bookings", "POST", { shiftId: series.shifts[0].id, userId: users.employee.id }, 409);
  await employee.request("/api/time/watch", "POST", { action: "START" });
  await employee.request("/api/time/watch", "POST", { action: "START" }, 409);
  await employee.request("/api/time/watch", "POST", { action: "PAUSE" });
  check((await employee.request("/api/time/watch")).running.pauseStartedAt, "pause persisted");
  await employee.request("/api/time/watch", "POST", { action: "RESUME" });
  await employee.request("/api/time/watch", "POST", { action: "STOP" });
  check((await employee.request("/api/time/watch")).running === null, "work end persists");
  await employee.request("/api/time", "POST", { type: "MANUAL", userId: users.employee.id, date: today, timeFrom: "08:00", timeTo: "16:00", categoryId: foreignCategory.id }, 400);
  const time = (await employee.request("/api/time", "POST", { type: "MANUAL", userId: users.employee.id, date: today, timeFrom: "08:00", timeTo: "16:00" }, 201)).record;
  const correction = (await employee.request("/api/time/" + time.id, "PATCH", { timeTo: "17:00", breakMinutes: 30, reason: "Arbeitsende falsch erfasst" })).correction;
  await employee.request("/api/time/corrections", "PATCH", { id: correction.id, status: "APPROVED" }, 403);
  await foreign.request("/api/time/corrections", "PATCH", { id: correction.id, status: "APPROVED" }, 404);
  await admin.request("/api/time/corrections", "PATCH", { id: correction.id, status: "APPROVED" });
  await admin.request("/api/time/corrections", "PATCH", { id: correction.id, status: "APPROVED" }, 409);
  const records = await employee.request("/api/time?month=" + today.slice(0,7));
  check(records.employees.every((e:any) => e.userId === users.employee.id), "employee can only read own time");
  check(records.employees[0].records.find((t:any) => t.id === time.id).timeTo === "17:00", "approved correction changes original record");
  const report = await employee.request("/api/reporting");
  check(report.employees.length === 1 && report.employees[0].totalMinutes >= 510, "monthly total deducts breaks");
  check(recordMinutes({ type: "WATCH", startedAt: "2026-10-24T20:00:00Z", endedAt: "2026-10-25T05:00:00Z", timeFrom: "22:00", timeTo: "06:00", durationHours:null, durationMinutes:null, breakSeconds: 1800 }) === 510, "DST overnight actual time");
  const csv = await employee.request("/api/reporting/export");
  check(csv.includes("Sollstunden") && csv.includes("8,50") && !csv.includes("Alex"), "CSV exports own real hours in German format");
  const message = (await admin.request("/api/messages", "POST", { subject: "Schichtinfo", body: "Bitte Pforte nutzen.", recipientIds: [users.employee.id], shiftId: shift.id }, 201)).message;
  await employee.request("/api/messages/" + message.id);
  check((await admin.request("/api/messages?folder=sent")).messages.find((m:any) => m.id === message.id).recipients[0].isRead, "message read status persisted");
  check((await employee.request("/api/dashboard")).own.length > 0, "employee home has own upcoming shifts");
  check((await admin.request("/api/dashboard")).manager, "administrator home uses manager view");
  await employee.request("/api/employees/" + users.employee.memberId, "PATCH", { targetHoursPerWeek: 1 }, 403);
  await admin.request("/api/employees/" + users.employee.memberId, "PATCH", { targetHoursPerWeek: 30, qualifications: ["Erste Hilfe", "Brandschutz"] });
  const newPeople = await admin.request("/api/employees", "POST", { employees: [{ firstName: "Neu", lastName: "Test", email: "new@akro-test.invalid", role: "EMPLOYEE" }] }, 201);
  check(!JSON.stringify(newPeople).includes("activationToken"), "created accounts do not expose activation tokens");
  const invite = await admin.request("/api/employees/" + newPeople.members[0].id + "/invite", "POST");
  const token = new URL(invite.url).searchParams.get("token");
  await anonymous.request("/api/auth/activate", "POST", { token, password });
  await anonymous.request("/api/auth/activate", "POST", { token, password }, 400);
  // Basiskette weiter: das aktivierte Konto meldet sich an, sieht nur die
  // eigene Organisation, erreicht keine fremden Stammdaten - und nach dem
  // Deaktivieren kommt es nicht mehr hinein.
  const eingeladen = new Session();
  await eingeladen.login("new@akro-test.invalid");
  check((await eingeladen.request("/api/me")).organizationId === org.id, "activated employee belongs only to the inviting organization");
  await eingeladen.request("/api/employees/" + users.admin.memberId, "PATCH", { targetHoursPerWeek: 5 }, 404);
  await admin.request("/api/employees/" + newPeople.members[0].id, "PATCH", { isActive: false });
  await eingeladen.request("/api/me", "GET", undefined, 401);
  await new Session().loginFails("new@akro-test.invalid", "deactivated employee cannot sign in");
  await admin.request("/api/shifts/" + conflict.id, "DELETE");
  check((await employee.request(weekPath)).schedule.shifts.every((s:any) => s.id !== conflict.id), "deleted shift removed from plan");
  check((await admin.request("/api/branches")).branches.some((b:any) => b.id === branch.id && b.isActive && b.customer?.id === customer.id), "location list is connected to database");
  await employee.request("/api/employees", "GET", undefined, 403);
  const directory = await admin.request("/api/employees");
  check(!JSON.stringify(directory).includes("activationToken") && !JSON.stringify(directory).includes("passwordHash"), "directory excludes authentication secrets");
  await employee.request("/api/time", "POST", { type: "MANUAL", userId: users.employee.id, date: today, timeFrom: "08:00", timeTo: "08:00" }, 400);
  await employee.request("/api/time", "POST", { type: "MANUAL", userId: users.employee.id, date: today, timeFrom: "08:00", timeTo: "09:00", breakMinutes: 90 }, 400);
  await employee.request("/api/absences", "POST", { userId: users.employee.id, categoryId: category.id, dateFrom: "2026-02-30", dateTo: "2026-03-02" }, 400);
  await employee.request("/api/time/" + time.id, "DELETE", undefined, 409);
  console.log("SUCCESS: " + checks + " assertions / HTTP checks passed.");

  const context: TestContext = { base, users, password, categoryId: category.id, check, Session: Session as unknown as TestContext["Session"], counter: () => checks };
  await permissionTests(context);
  console.log("FINAL SUCCESS: " + checks + " assertions / HTTP checks passed.");
  if (process.argv.includes("--serve")) {
    console.log("BROWSER_PREVIEW " + base + " — admin@akro-test.invalid / " + password);
    await new Promise<void>(resolve => { process.on("SIGTERM",resolve); process.on("SIGINT",resolve); });
  }
} catch (error) {
  console.error(serverLog);
  throw error;
} finally {
  await herunterfahren();
}

/* Beendet den Entwicklungsserver mitsamt seinen Arbeitsprozessen. Windows
   kennt keine Prozessgruppen, deshalb dort taskkill mit /t. */
async function beendeServer() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const beendet = once(child, "exit").then(() => true).catch(() => true);
  if (process.platform === "win32" && child.pid) {
    const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    await Promise.race([once(taskkill, "exit").catch(() => undefined), warte(5000)]);
  } else {
    child.kill("SIGTERM");
  }
  if (await Promise.race([beendet, warte(8000).then(() => false)])) return;
  child.kill("SIGKILL");
  await Promise.race([beendet, warte(2000)]);
}

/* Geordneter Abbau. Zuerst wird die Datenbankverbindung geloest, dann der
   Server beendet: stirbt der Server zuerst, reisst er die Verbindung ab und
   der PGlite-Socket-Handler lehnt seine interne Sperre mit ECONNRESET ab -
   eine Ablehnung, die niemand entgegennimmt. Der Waechter unten deckt nur
   diesen Abbau ab und laesst ausschliesslich Verbindungsabbrueche durch. */
async function herunterfahren() {
  const beimAbbau = (grund: unknown) => {
    const code = (grund as NodeJS.ErrnoException | null)?.code ?? "";
    if (code === "ECONNRESET" || code === "EPIPE" || code === "ECONNABORTED") return;
    console.error(grund);
    process.exitCode = 1;
  };
  process.on("unhandledRejection", beimAbbau);
  try {
    await Promise.race([socket.stop(), warte(5000)]);
    await beendeServer();
    await sql.close();
  } finally {
    process.off("unhandledRejection", beimAbbau);
  }
}
}
function warte(ms: number) { return new Promise<void>(r => { setTimeout(r, ms); }); }
main().catch(error => { console.error(error); process.exitCode = 1; });
