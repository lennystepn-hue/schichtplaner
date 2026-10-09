/*
 * Prueft die Migration auf Kunden und Standortplaene an einem Altbestand:
 * Die alten Migrationen laufen zuerst, dann werden typische Altdaten
 * angelegt (org-weite Wochenplaene mit Schichten mehrerer Standorte,
 * Schichten ohne Standort, Widersprueche, Briefing, Live-Daten,
 * Nachrichten, Zeitbuchungen), danach laeuft die neue Migration.
 * Arbeitet ausschliesslich mit einer eigenen In-Memory-Datenbank.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const NEW_MIGRATION = "20260924090000_customers_branch_access";
let checks = 0;
function check(value: unknown, message: string) {
  assert.ok(value, message);
  checks++;
  console.log("PASS: " + message);
}

async function database(upTo: string) {
  const sql = new PGlite();
  const migrations = (await readdir("prisma/migrations")).filter((x) => /^\d/.test(x) && x < upTo).sort();
  for (const migration of migrations) await sql.exec(await readFile("prisma/migrations/" + migration + "/migration.sql", "utf8"));
  return sql;
}

async function rows<T = Record<string, unknown>>(sql: PGlite, text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql.query<T>(text, params)).rows;
}

const now = "CURRENT_TIMESTAMP";

async function legacyData(sql: PGlite) {
  await sql.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt","scheduleVisibility") VALUES ('orgA','Alt-Organisation',${now},'ALL'),('orgB','Andere Organisation',${now},'OWN_ONLY');
    INSERT INTO "users" ("id","email","firstName","lastName","updatedAt") VALUES
      ('u1','u1@akro-test.invalid','Uwe','Eins',${now}),('u2','u2@akro-test.invalid','Ute','Zwei',${now}),
      ('u3','u3@akro-test.invalid','Udo','Drei',${now}),('uB','ub@akro-test.invalid','Bea','Fremd',${now});
    INSERT INTO "organization_members" ("id","organizationId","userId","role","isActivated") VALUES
      ('m1','orgA','u1','EMPLOYEE',true),('m2','orgA','u2','EMPLOYEE',true),('m3','orgA','u3','MANAGER',true),('mB','orgB','uB','ADMIN',true);
    INSERT INTO "branches" ("id","organizationId","name") VALUES ('A1','orgA','Objekt Nord'),('A2','orgA','Objekt Sued'),('B1','orgB','Fremdobjekt');

    -- KW 10/2026: organisationsweiter Altplan, veroeffentlicht, eigene Darstellung
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","settingsLayout","showTitle","showPauses","updatedAt")
      VALUES ('S','orgA',NULL,10,2026,true,'LAYOUT_2',false,true,${now});
    INSERT INTO "shifts" ("id","scheduleId","branchId","dayOfWeek","shiftFrom","shiftTo","maxEmployees","title","deletedAt") VALUES
      ('s1','S','A1',1,'06:00','14:00',2,'Frueh',NULL),
      ('s2','S','A2',2,'14:00','22:00',1,'Spaet',NULL),
      ('s3','S',NULL,3,'08:00','16:00',1,'Ohne Standort',NULL),
      ('s4','S','A1',4,'08:00','16:00',1,'Geloescht','2026-03-01 10:00:00'),
      ('s8','S','A1',5,'22:00','06:00',1,'Nacht',NULL),
      ('s10','S','A1',3,'17:00','21:00',1,'Abend',NULL),
      ('s11','S','A2',3,'06:00','07:00',1,'Kurz',NULL);
    INSERT INTO "bookings" ("id","shiftId","userId","confirmedAt") VALUES
      ('b1','s1','u1','2026-02-27 09:00:00'),('b2','s2','u2',NULL),('b3','s3','u3',NULL),('b8','s8','u1',NULL),
      ('b10','s10','u3',NULL),('b11','s11','u3',NULL);
    INSERT INTO "mod_requests" ("id","shiftId","userId","kind","state") VALUES ('r2','s2','u2','SWAP','OPEN');
    INSERT INTO "messages" ("id","organizationId","senderId","subject","body","shiftId") VALUES ('msg1','orgA','u1','Schichtinfo','Bitte Pforte nutzen.','s1');
    INSERT INTO "message_recipients" ("messageId","userId") VALUES ('msg1','u2');
    INSERT INTO "briefings" ("id","scheduleId","text","updatedAt") VALUES ('br1','S','Briefing KW 10',${now});
    INSERT INTO "live_sessions" ("id","scheduleId","isActive","bookRequests","allowExceeds") VALUES ('L','S',true,true,false);
    INSERT INTO "live_days" ("id","liveSessionId","dayOfWeek","enabled")
      SELECT 'LD' || d, 'L', d, d <> 7 FROM generate_series(1,7) d;
    INSERT INTO "live_logs" ("id","liveSessionId","shiftId","userId","action") VALUES
      ('LL1','L','s1','u1','BOOK'),('LL2','L','s2','u2','BOOK'),('LL3','L','s3','u3','BOOK');

    -- KW 11/2026: Entwurf
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('S2','orgA',NULL,11,2026,false,${now});
    INSERT INTO "shifts" ("id","scheduleId","branchId","dayOfWeek","shiftFrom","shiftTo") VALUES ('s5','S2','A1',1,'08:00','16:00');
    INSERT INTO "bookings" ("id","shiftId","userId") VALUES ('b5','s5','u1');

    -- KW 12/2026: vorhandener Standortplan mit widerspruechlicher Schicht
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('SB','orgA','A2',12,2026,true,${now});
    INSERT INTO "shifts" ("id","scheduleId","branchId","dayOfWeek","shiftFrom","shiftTo") VALUES ('s6','SB','A1',1,'08:00','16:00'),('s7','SB',NULL,2,'08:00','16:00');

    -- Fremde Organisation
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('SX','orgB',NULL,10,2026,true,${now});
    INSERT INTO "shifts" ("id","scheduleId","branchId","dayOfWeek","shiftFrom","shiftTo") VALUES ('x1','SX','B1',1,'06:00','14:00');
    INSERT INTO "bookings" ("id","shiftId","userId") VALUES ('bx','x1','uB');

    INSERT INTO "time_records" ("id","userId","organizationId","date","type","timeFrom","timeTo","durationHours","durationMinutes","updatedAt") VALUES
      ('t1','u1','orgA','2026-03-02','MANUAL','06:00','14:00',NULL,NULL,${now}),
      ('t2','u2','orgA','2026-03-03','MANUAL_DURATION',NULL,NULL,8,0,${now}),
      ('t3','u3','orgA','2026-03-04','MANUAL','08:00','16:00',NULL,NULL,${now}),
      ('t4','u1','orgA','2026-03-05','MANUAL','08:00','10:00',NULL,NULL,${now}),
      ('t5','u1','orgA','2026-03-09','MANUAL','08:00','16:00',NULL,NULL,${now}),
      ('t6','u1','orgA','2026-03-06','WATCH','23:00','05:00',NULL,NULL,${now}),
      ('t7','u1','orgA','2026-03-07','MANUAL','01:00','04:00',NULL,NULL,${now}),
      ('t9','u3','orgA','2026-03-04','MANUAL_DURATION',NULL,NULL,2,0,${now}),
      ('tB','uB','orgB','2026-03-02','MANUAL','06:00','14:00',NULL,NULL,${now});
  `);
}

async function main() {
  const sql = await database(NEW_MIGRATION);
  await legacyData(sql);
  const count = async (table: string) => Number((await rows<{ n: number }>(sql, `SELECT count(*)::int AS n FROM "${table}"`))[0].n);
  const before: Record<string, number> = {};
  for (const table of ["shifts", "bookings", "mod_requests", "messages", "message_recipients", "live_logs", "time_records", "branches", "schedules", "briefings", "live_sessions", "live_days"]) before[table] = await count(table);
  const bookingsBefore = await rows(sql, `SELECT "id","shiftId","userId","confirmedAt" FROM "bookings" ORDER BY "id"`);

  await sql.exec(await readFile("prisma/migrations/" + NEW_MIGRATION + "/migration.sql", "utf8"));
  console.log("PASS: migration applied on legacy data");

  for (const table of ["shifts", "bookings", "mod_requests", "messages", "message_recipients", "live_logs", "time_records", "branches"]) {
    check((await count(table)) === before[table], table + " unchanged in number");
  }
  check(JSON.stringify(await rows(sql, `SELECT "id","shiftId","userId","confirmedAt" FROM "bookings" ORDER BY "id"`)) === JSON.stringify(bookingsBefore), "bookings unchanged incl. confirmations");

  const place = async (shift: string) => (await rows<{ branch: string | null; week: number; public: boolean; schedule: string; deleted: boolean }>(sql,
    `SELECT sc."branchId" AS branch, sc."weekNumber" AS week, sc."isPublic" AS public, sc."id" AS schedule, s."deletedAt" IS NOT NULL AS deleted
     FROM "shifts" s JOIN "schedules" sc ON sc."id" = s."scheduleId" WHERE s."id" = $1`, [shift]))[0];
  const expected: Record<string, [string | null, number, boolean]> = {
    s1: ["A1", 10, true], s2: ["A2", 10, true], s3: [null, 10, true], s4: ["A1", 10, true], s8: ["A1", 10, true],
    s10: ["A1", 10, true], s11: ["A2", 10, true], s5: ["A1", 11, false], s6: ["A1", 12, true], s7: ["A2", 12, true], x1: ["B1", 10, true],
  };
  for (const [shift, [branch, week, isPublic]] of Object.entries(expected)) {
    const p = await place(shift);
    check(p.branch === branch && p.week === week && p.public === isPublic, `shift ${shift} lies in plan ${branch ?? "ohne Standort"} KW ${week} (${isPublic ? "veroeffentlicht" : "Entwurf"})`);
  }
  check((await place("s3")).schedule === "S", "shift without location stays in the legacy plan");
  check((await place("s7")).schedule === "SB", "shift without own location keeps its location plan");
  check((await place("s4")).deleted, "deleted shift stays deleted after the move");
  check((await place("s1")).schedule === (await place("s8")).schedule && (await place("s1")).schedule !== (await place("s2")).schedule, "one plan per location and week");

  const a1w10 = await rows<{ settingsLayout: string; showTitle: boolean; showPauses: boolean }>(sql, `SELECT "settingsLayout","showTitle","showPauses" FROM "schedules" WHERE "branchId"='A1' AND "weekNumber"=10`);
  check(a1w10.length === 1 && a1w10[0].settingsLayout === "LAYOUT_2" && a1w10[0].showTitle === false && a1w10[0].showPauses === true, "display settings copied from the legacy plan");
  check((await rows(sql, `SELECT 1 FROM "schedules" WHERE "organizationId"='orgA' AND "branchId"='B1'`)).length === 0, "no plan links a foreign organization's location");

  const briefings = await rows<{ branchId: string | null; text: string }>(sql, `SELECT sc."branchId", b."text" FROM "briefings" b JOIN "schedules" sc ON sc."id" = b."scheduleId" WHERE sc."weekNumber" = 10 AND sc."organizationId" = 'orgA' ORDER BY sc."branchId" NULLS FIRST`);
  check(briefings.length === 3 && briefings.every((b) => b.text === "Briefing KW 10"), "briefing kept on the legacy plan and copied into each location plan");

  const sessions = await rows<{ id: string; branchId: string | null; isActive: boolean; bookRequests: boolean; days: number; disabled: number }>(sql,
    `SELECT l."id", sc."branchId", l."isActive", l."bookRequests",
            (SELECT count(*)::int FROM "live_days" d WHERE d."liveSessionId" = l."id") AS days,
            (SELECT count(*)::int FROM "live_days" d WHERE d."liveSessionId" = l."id" AND NOT d."enabled") AS disabled
     FROM "live_sessions" l JOIN "schedules" sc ON sc."id" = l."scheduleId" WHERE sc."organizationId" = 'orgA' ORDER BY sc."branchId" NULLS FIRST`);
  check(sessions.length === 3 && sessions.every((s) => s.isActive && s.bookRequests && s.days === 7 && s.disabled === 1), "live session with its days copied into each location plan");
  const logs = await rows<{ id: string; branchId: string | null }>(sql, `SELECT lg."id", sc."branchId" FROM "live_logs" lg JOIN "live_sessions" l ON l."id" = lg."liveSessionId" JOIN "schedules" sc ON sc."id" = l."scheduleId" ORDER BY lg."id"`);
  check(logs.find((l) => l.id === "LL1")?.branchId === "A1" && logs.find((l) => l.id === "LL2")?.branchId === "A2" && logs.find((l) => l.id === "LL3")?.branchId === null, "live logs follow their shifts");

  check((await rows<{ shiftId: string }>(sql, `SELECT "shiftId" FROM "messages" WHERE "id"='msg1'`))[0].shiftId === "s1", "message keeps its shift");
  check((await rows<{ shiftId: string; state: string }>(sql, `SELECT "shiftId","state" FROM "mod_requests" WHERE "id"='r2'`))[0].state === "OPEN", "request keeps shift and state");

  check((await count("customers")) === 0 && (await rows(sql, `SELECT 1 FROM "branches" WHERE "customerId" IS NOT NULL`)).length === 0, "no customer invented, legacy locations stay unassigned");

  const times = Object.fromEntries((await rows<{ id: string; branchId: string | null }>(sql, `SELECT "id","branchId" FROM "time_records"`)).map((r) => [r.id, r.branchId]));
  check(times.t1 === "A1", "time record overlapping a published shift gets its location");
  check(times.t2 === "A2", "duration record matches the shift of the same day");
  check(times.t3 === null, "record at a shift without location stays unassigned");
  check(times.t4 === null, "record without shift stays unassigned");
  check(times.t5 === null, "record at a draft shift stays unassigned");
  check(times.t6 === "A1" && times.t7 === "A1", "overnight shift assigns records before and after midnight");
  check(times.t9 === null, "ambiguous day (two locations) stays unassigned");
  check(times.tB === "B1", "assignment stays within the organization");

  const columns = await rows(sql, `SELECT 1 FROM information_schema.columns WHERE table_name IN ('shifts','organizations') AND column_name IN ('branchId','scheduleVisibility')`);
  check(columns.length === 0, "shift location and organisation-wide visibility removed");

  const rejects = async (statement: string, message: string) => {
    await assert.rejects(sql.exec(statement), Error, message);
    checks++;
    console.log("PASS: " + message);
  };
  await rejects(`INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","updatedAt") VALUES ('bad','orgA','B1',20,2026,${now})`, "plan cannot use a location of another organisation");
  await sql.exec(`INSERT INTO "customers" ("id","organizationId","name","updatedAt") VALUES ('cB','orgB','Fremdkunde',${now})`);
  await rejects(`UPDATE "branches" SET "customerId"='cB' WHERE "id"='A1'`, "location cannot belong to a customer of another organisation");
  await rejects(`INSERT INTO "branch_access" ("id","organizationId","memberId","branchId","updatedAt") VALUES ('ba','orgA','mB','A1',${now})`, "grant cannot mix members of another organisation");
  await rejects(`INSERT INTO "branch_access" ("id","organizationId","memberId","branchId","updatedAt") VALUES ('ba','orgA','m1','B1',${now})`, "grant cannot mix locations of another organisation");
  await rejects(`INSERT INTO "time_records" ("id","userId","organizationId","branchId","date","type","updatedAt") VALUES ('tx','u1','orgA','B1','2026-03-02','MANUAL',${now})`, "time record cannot use a location of another organisation");
  await sql.close();

  // Widerspruch ohne eindeutige Aufloesung: die Migration bricht ab und
  // laesst den Altbestand unveraendert.
  const conflict = await database(NEW_MIGRATION);
  await conflict.exec(`
    INSERT INTO "organizations" ("id","name","updatedAt") VALUES ('o','Org',${now});
    INSERT INTO "branches" ("id","organizationId","name") VALUES ('b','o','Objekt');
    INSERT INTO "schedules" ("id","organizationId","branchId","weekNumber","year","isPublic","updatedAt") VALUES ('p1','o',NULL,10,2026,true,${now}),('p2','o',NULL,10,2026,false,${now});
    INSERT INTO "shifts" ("id","scheduleId","branchId","dayOfWeek","shiftFrom","shiftTo") VALUES ('a','p1','b',1,'08:00','16:00'),('c','p2','b',2,'08:00','16:00');
  `);
  await assert.rejects(conflict.exec(await readFile("prisma/migrations/" + NEW_MIGRATION + "/migration.sql", "utf8")), /unterschiedlichem Veroeffentlichungs/);
  await conflict.exec("ROLLBACK");
  check((await rows(conflict, `SELECT 1 FROM information_schema.columns WHERE table_name='shifts' AND column_name='branchId'`)).length === 1, "contradictory legacy plans abort the migration without changes");
  await conflict.close();

  console.log("SUCCESS: " + checks + " migration checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
