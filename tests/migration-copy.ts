/*
 * Migrationsprobe an einer KOPIE echter Daten.
 *
 *   DATABASE_URL="postgresql://…/schichtplaner_kopie" npm run test:migration:copy
 *
 * Laeuft nur, wenn der Datenbankname "copy", "kopie" oder "migtest" enthaelt:
 * Das Skript spielt ausstehende Migrationen ein (prisma migrate deploy) und
 * darf deshalb niemals die Produktivdatenbank treffen. Es gibt ausschliesslich
 * Zaehlwerte aus, keine Namen oder Inhalte.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "";
const dbName = decodeURIComponent(new URL(url || "postgresql://x/none").pathname.slice(1));
if (!url || !/(copy|kopie|migtest)/i.test(dbName)) {
  console.error("Abbruch: DATABASE_URL muss auf eine Kopie zeigen (Datenbankname mit copy, kopie oder migtest).");
  process.exit(1);
}

const TABLES = ["users", "organizations", "organization_members", "branches", "divisions", "shifts", "bookings", "mod_requests", "messages", "message_recipients", "live_logs", "time_records", "time_corrections", "absences", "availabilities", "holidays", "topics", "topic_posts", "employee_notes", "portal_files"];

const connections: pg.Client[] = [];
async function main() {
  const client = new pg.Client({ connectionString: url });
  connections.push(client);
  await client.connect();
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(text: string) => (await client.query<T>(text)).rows;
  const hasColumn = async (table: string, column: string) => (await q(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`)).length > 0;
  const hasTable = async (table: string) => (await q(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}'`)).length > 0;

  if (!(await hasColumn("shifts", "scheduleId"))) throw new Error("Kein Schichtplaner-Schema gefunden.");
  if (!(await hasColumn("organizations", "scheduleVisibility"))) throw new Error("Die Kopie ist bereits migriert. Bitte eine frische Kopie verwenden.");

  // --- Vorher: Zaehlwerte und die erwartete Zuordnung jeder Schicht ------
  // Aeltere Kopien kennen manche Tabellen noch nicht; verglichen wird, was
  // vorher vorhanden war.
  const before: Record<string, number> = {};
  for (const table of TABLES) if (await hasTable(table)) before[table] = Number((await q<{ n: string }>(`SELECT count(*) AS n FROM "${table}"`))[0].n);
  const shiftBranch = (await hasColumn("shifts", "branchId")) ? `COALESCE(s."branchId", sc."branchId")` : `sc."branchId"`;
  await client.query(`DROP TABLE IF EXISTS "_mig_expected"; CREATE TABLE "_mig_expected" AS
    SELECT s."id" AS shift_id, ${shiftBranch} AS branch_id, sc."isPublic" AS is_public, sc."weekNumber" AS week, sc."year" AS year, sc."organizationId" AS org
    FROM "shifts" s JOIN "schedules" sc ON sc."id" = s."scheduleId"`);
  const confirmed = (await hasColumn("bookings", "confirmedAt")) ? `"confirmedAt"` : `NULL::timestamp(3) AS "confirmedAt"`;
  await client.query(`DROP TABLE IF EXISTS "_mig_bookings"; CREATE TABLE "_mig_bookings" AS SELECT "id", "shiftId", "userId", ${confirmed} FROM "bookings"`);
  await client.query(`DROP TABLE IF EXISTS "_mig_links"; CREATE TABLE "_mig_links" AS
    ${(await hasColumn("messages", "shiftId")) ? `SELECT 'message' AS kind, "id", "shiftId" FROM "messages" WHERE "shiftId" IS NOT NULL UNION ALL` : ""}
    SELECT 'request' AS kind, "id", "shiftId" FROM "mod_requests"
    UNION ALL SELECT 'live', "id", "shiftId" FROM "live_logs"`);
  const legacy = (await q<{ plans: string; shifts: string; mixed: string }>(`SELECT
      (SELECT count(*) FROM "schedules" WHERE "branchId" IS NULL) AS plans,
      (SELECT count(*) FROM "_mig_expected" WHERE branch_id IS NULL) AS shifts,
      (SELECT count(*) FROM (SELECT DISTINCT sc."id" FROM "_mig_expected" e JOIN "shifts" s ON s."id" = e.shift_id JOIN "schedules" sc ON sc."id" = s."scheduleId" WHERE sc."branchId" IS DISTINCT FROM e.branch_id) x) AS mixed`))[0];
  console.log(`Vorher: ${before.shifts} Schichten, ${before.bookings} Buchungen, ${legacy.plans} Plaene ohne Standort, ${legacy.mixed} aufzuteilende Plaene, ${legacy.shifts} Schichten ohne Standort.`);
  await client.end();
  connections.splice(connections.indexOf(client), 1);

  // --- Migration auf dem regulaeren Weg -------------------------------
  const deploy = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
  if (deploy.status !== 0) {
    console.error(deploy.stdout.split("\n").filter((l) => /migration|error|Error|failed|Abbruch|abgebrochen/i.test(l)).join("\n"));
    console.error(deploy.stderr.split("\n").filter((l) => /error|Error|failed|abgebrochen|RAISE|EXCEPTION/i.test(l)).slice(0, 20).join("\n"));
    throw new Error("prisma migrate deploy ist fehlgeschlagen.");
  }
  console.log("prisma migrate deploy: erfolgreich");

  const after = new pg.Client({ connectionString: url });
  connections.push(after);
  await after.connect();
  const r = async <T extends pg.QueryResultRow = Record<string, unknown>>(text: string) => (await after.query<T>(text)).rows;
  let checks = 0;
  const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; console.log("PASS: " + message); };

  for (const table of Object.keys(before)) {
    const n = Number((await r<{ n: string }>(`SELECT count(*) AS n FROM "${table}"`))[0].n);
    check(n === before[table], `${table}: ${n} Zeilen (unveraendert)`);
  }
  const wrongPlace = Number((await r<{ n: string }>(`SELECT count(*) AS n FROM "_mig_expected" e JOIN "shifts" s ON s."id" = e.shift_id JOIN "schedules" sc ON sc."id" = s."scheduleId"
    WHERE sc."branchId" IS DISTINCT FROM e.branch_id OR sc."isPublic" <> e.is_public OR sc."weekNumber" <> e.week OR sc."year" <> e.year OR sc."organizationId" <> e.org`))[0].n);
  check(wrongPlace === 0, "jede Schicht liegt im Plan ihres Standorts, ihrer Woche und mit ihrem Veroeffentlichungsstatus");
  const changedBookings = Number((await r<{ n: string }>(`SELECT count(*) AS n FROM "_mig_bookings" o FULL JOIN "bookings" b ON b."id" = o."id"
    WHERE b."id" IS NULL OR o."id" IS NULL OR b."shiftId" <> o."shiftId" OR b."userId" <> o."userId" OR b."confirmedAt" IS DISTINCT FROM o."confirmedAt"`))[0].n);
  check(changedBookings === 0, "Buchungen samt Bestaetigung unveraendert");
  const changedLinks = Number((await r<{ n: string }>(`SELECT count(*) AS n FROM "_mig_links" l
    LEFT JOIN "messages" m ON l.kind = 'message' AND m."id" = l."id" LEFT JOIN "mod_requests" q ON l.kind = 'request' AND q."id" = l."id" LEFT JOIN "live_logs" g ON l.kind = 'live' AND g."id" = l."id"
    WHERE COALESCE(m."shiftId", q."shiftId", g."shiftId") IS DISTINCT FROM l."shiftId"`))[0].n);
  check(changedLinks === 0, "Nachrichten, Antraege und Live-Protokolle verweisen auf dieselben Schichten");
  const foreignLogs = Number((await r<{ n: string }>(`SELECT count(*) AS n FROM "live_logs" g JOIN "shifts" s ON s."id" = g."shiftId" JOIN "live_sessions" l ON l."id" = g."liveSessionId"
    WHERE l."scheduleId" <> s."scheduleId" AND EXISTS (SELECT 1 FROM "live_sessions" x WHERE x."scheduleId" = s."scheduleId")`))[0].n);
  check(foreignLogs === 0, "Live-Protokolle haengen an der Live-Sitzung des Plans ihrer Schicht");
  check(Number((await r<{ n: string }>(`SELECT count(*) AS n FROM "customers"`))[0].n) === 0, "kein Kunde erfunden");
  check(Number((await r<{ n: string }>(`SELECT count(*) AS n FROM "branches" WHERE "customerId" IS NOT NULL`))[0].n) === 0, "Standorte bleiben bis zur Zuordnung ohne Kunde");
  const time = (await r<{ assigned: string; open: string }>(`SELECT count(*) FILTER (WHERE "branchId" IS NOT NULL) AS assigned, count(*) FILTER (WHERE "branchId" IS NULL) AS open FROM "time_records"`))[0];
  const plans = (await r<{ located: string; legacy: string; legacyShifts: string }>(`SELECT count(*) FILTER (WHERE "branchId" IS NOT NULL) AS located, count(*) FILTER (WHERE "branchId" IS NULL) AS legacy,
    (SELECT count(*) FROM "shifts" s JOIN "schedules" sc ON sc."id" = s."scheduleId" WHERE sc."branchId" IS NULL) AS "legacyShifts" FROM "schedules"`))[0];
  console.log(`Nachher: ${plans.located} Standortplaene, ${plans.legacy} Plaene ohne Standort mit zusammen ${plans.legacyShifts} Schichten (Altbestand, nur Admins).`);
  console.log(`Zeitbuchungen: ${time.assigned} einem Standort zugeordnet, ${time.open} ohne eindeutigen Standort (nur Person und Admins).`);
  await after.query(`DROP TABLE "_mig_expected"; DROP TABLE "_mig_bookings"; DROP TABLE "_mig_links";`);
  await after.end();
  connections.splice(connections.indexOf(after), 1);
  console.log("SUCCESS: " + checks + " Pruefungen an der Kopie bestanden.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  // Offene Verbindungen wuerden den Prozess sonst am Beenden hindern.
  .finally(() => Promise.allSettled(connections.map((c) => c.end())));
