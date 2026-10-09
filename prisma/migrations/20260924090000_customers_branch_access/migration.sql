-- Kunden, Standortfreigaben, Personalzuordnung und Standortmeldungen.
--
-- Wochenplaene werden je Standort gefuehrt: der Standort einer Schicht
-- ergibt sich nur noch aus ihrem Plan (schedules."branchId"). Altplaene, in
-- denen Schichten verschiedener Standorte lagen, werden verlustfrei nach dem
-- Standort der Schichten aufgeteilt. Buchungen, Antraege und Nachrichten
-- haengen an der Schicht und ziehen mit; Veroeffentlichung, Darstellung,
-- Briefing und Live-Daten werden in den Standortplan uebernommen.
--
-- Nichts wird geloescht. Schichten ohne Standort bleiben im Altplan
-- (Altbestand, nur fuer Admins sichtbar). Kein Standort und keine Schicht
-- wird automatisch einem Kunden zugeordnet. Widersprueche, die sich nicht
-- eindeutig aufloesen lassen, brechen die Migration ab.
BEGIN;

CREATE TYPE "BranchRight" AS ENUM ('VIEW_SCHEDULE', 'EDIT_SHIFTS', 'PUBLISH_SCHEDULE', 'HANDLE_REQUESTS', 'VIEW_TIME', 'EDIT_TIME', 'MANAGE_ISSUES', 'REQUEST_SHIFTS');
CREATE TYPE "StaffRight" AS ENUM ('ASSIGN_SHIFTS', 'VIEW_PROFILE', 'EDIT_PROFILE', 'MANAGE_ABSENCES', 'VIEW_HOURS');
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- --- Kunden -----------------------------------------------------------
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customers_organizationId_name_key" ON "customers"("organizationId", "name");
ALTER TABLE "customers" ADD CONSTRAINT "customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bestehende Standorte bleiben ohne Kunde, bis ein Admin sie zuordnet.
ALTER TABLE "branches" ADD COLUMN "customerId" TEXT;
CREATE INDEX "branches_organizationId_customerId_idx" ON "branches"("organizationId", "customerId");
CREATE UNIQUE INDEX "branches_id_organizationId_key" ON "branches"("id", "organizationId");
ALTER TABLE "branches" ADD CONSTRAINT "branches_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "organization_members_id_organizationId_key" ON "organization_members"("id", "organizationId");

-- --- Altplaene nach Standort aufteilen ---------------------------------
-- Betroffen ist jede Schicht mit eigenem Standort, deren Plan keinen oder
-- einen anderen Standort traegt. Die Schicht folgt ihrem eigenen Standort,
-- denn der kam aus dem Schichtformular.
CREATE TEMP TABLE "_mig_moves" ON COMMIT DROP AS
SELECT s."id" AS shift_id, sc."id" AS source_id, sc."organizationId" AS org, s."branchId" AS branch_id,
       sc."weekNumber" AS week, sc."year" AS year, sc."isPublic" AS is_public, sc."deletedAt" AS deleted_at,
       sc."settingsLayout" AS layout, sc."showTitle" AS show_title, sc."showPauses" AS show_pauses,
       sc."createdAt" AS created_at
FROM "shifts" s
JOIN "schedules" sc ON sc."id" = s."scheduleId"
WHERE s."branchId" IS NOT NULL AND sc."branchId" IS DISTINCT FROM s."branchId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "_mig_moves" m JOIN "branches" b ON b."id" = m.branch_id WHERE b."organizationId" <> m.org) THEN
    RAISE EXCEPTION 'Schichten verweisen auf Standorte einer anderen Organisation. Migration abgebrochen; bitte manuell pruefen.';
  END IF;
  -- Mehrere Altplaene derselben Woche mit unterschiedlichem Status lassen
  -- sich nicht ohne Entscheidung zusammenfuehren.
  IF EXISTS (SELECT 1 FROM "_mig_moves" GROUP BY org, branch_id, week, year
             HAVING count(DISTINCT is_public) > 1 OR count(DISTINCT (deleted_at IS NULL)) > 1) THEN
    RAISE EXCEPTION 'Schichten eines Standorts liegen in derselben Woche in Plaenen mit unterschiedlichem Veroeffentlichungs- oder Loeschstatus. Migration abgebrochen; bitte manuell zusammenfuehren.';
  END IF;
  IF EXISTS (SELECT 1 FROM "_mig_moves" m JOIN "schedules" t
               ON t."organizationId" = m.org AND t."branchId" = m.branch_id AND t."weekNumber" = m.week AND t."year" = m.year
             WHERE t."isPublic" <> m.is_public OR (t."deletedAt" IS NULL) <> (m.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Ein vorhandener Standortplan hat einen anderen Veroeffentlichungs- oder Loeschstatus als der Altplan. Migration abgebrochen; bitte manuell pruefen.';
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT DISTINCT source_id, org, branch_id, week, year FROM "_mig_moves") m
             JOIN "live_sessions" l ON l."scheduleId" = m.source_id
             GROUP BY m.org, m.branch_id, m.week, m.year HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM "_mig_moves" m
                JOIN "live_sessions" l ON l."scheduleId" = m.source_id
                JOIN "schedules" t ON t."organizationId" = m.org AND t."branchId" = m.branch_id AND t."weekNumber" = m.week AND t."year" = m.year
                JOIN "live_sessions" tl ON tl."scheduleId" = t."id") THEN
    RAISE EXCEPTION 'Mehrere Live-Sitzungen muessten zusammengefuehrt werden. Migration abgebrochen; bitte manuell pruefen.';
  END IF;
END $$;

-- Standortplan je Woche anlegen, wo er noch fehlt. Status und Darstellung
-- kommen aus dem Altplan.
INSERT INTO "schedules" ("id", "organizationId", "branchId", "weekNumber", "year", "isPublic", "settingsLayout", "showTitle", "showPauses", "createdAt", "updatedAt", "deletedAt")
SELECT 'mig' || substr(md5('schedule:' || g.org || ':' || g.branch_id || ':' || g.year || ':' || g.week), 1, 22),
       g.org, g.branch_id, g.week, g.year, g.is_public, g.layout, g.show_title, g.show_pauses, g.created_at, CURRENT_TIMESTAMP, g.deleted_at
FROM (
  SELECT org, branch_id, week, year,
         bool_or(is_public) AS is_public,
         max(deleted_at) AS deleted_at,
         (array_agg(layout ORDER BY source_id))[1] AS layout,
         (array_agg(show_title ORDER BY source_id))[1] AS show_title,
         (array_agg(show_pauses ORDER BY source_id))[1] AS show_pauses,
         min(created_at) AS created_at
  FROM "_mig_moves"
  GROUP BY org, branch_id, week, year
) g
WHERE NOT EXISTS (
  SELECT 1 FROM "schedules" t
  WHERE t."organizationId" = g.org AND t."branchId" = g.branch_id AND t."weekNumber" = g.week AND t."year" = g.year
);

CREATE TEMP TABLE "_mig_targets" ON COMMIT DROP AS
SELECT DISTINCT m.source_id, t."id" AS target_id
FROM "_mig_moves" m
JOIN "schedules" t ON t."organizationId" = m.org AND t."branchId" = m.branch_id AND t."weekNumber" = m.week AND t."year" = m.year;

-- Schichten umhaengen. Buchungen, Antraege, Nachrichten und Live-Protokolle
-- verweisen auf die Schicht und bleiben damit unveraendert verbunden.
UPDATE "shifts" s SET "scheduleId" = t."id"
FROM "_mig_moves" m
JOIN "schedules" t ON t."organizationId" = m.org AND t."branchId" = m.branch_id AND t."weekNumber" = m.week AND t."year" = m.year
WHERE s."id" = m.shift_id;

-- Das Wochenbriefing galt fuer alle Schichten des Altplans; es bleibt dort
-- und wird in jeden daraus entstandenen Standortplan uebernommen.
INSERT INTO "briefings" ("id", "scheduleId", "text", "createdAt", "updatedAt")
SELECT 'mig' || substr(md5('briefing:' || b."id" || ':' || mt.target_id), 1, 22), mt.target_id, b."text", b."createdAt", b."updatedAt"
FROM "_mig_targets" mt
JOIN "briefings" b ON b."scheduleId" = mt.source_id
WHERE NOT EXISTS (SELECT 1 FROM "briefings" x WHERE x."scheduleId" = mt.target_id AND x."text" = b."text");

-- Live-Sitzung mit ihren Tagen in den Standortplan uebernehmen und die
-- Protokolle der verschobenen Schichten mitnehmen.
INSERT INTO "live_sessions" ("id", "scheduleId", "isActive", "deadline", "autoStop", "allowExceeds", "bookRequests", "startedAt")
SELECT DISTINCT ON (mt.target_id)
       'mig' || substr(md5('live:' || mt.target_id), 1, 22), mt.target_id, l."isActive", l."deadline", l."autoStop", l."allowExceeds", l."bookRequests", l."startedAt"
FROM "_mig_targets" mt
JOIN "live_sessions" l ON l."scheduleId" = mt.source_id
WHERE NOT EXISTS (SELECT 1 FROM "live_sessions" x WHERE x."scheduleId" = mt.target_id)
ORDER BY mt.target_id, mt.source_id;

INSERT INTO "live_days" ("id", "liveSessionId", "dayOfWeek", "enabled")
SELECT 'mig' || substr(md5('liveday:' || ns."id" || ':' || d."dayOfWeek"), 1, 22), ns."id", d."dayOfWeek", d."enabled"
FROM "_mig_targets" mt
JOIN "live_sessions" os ON os."scheduleId" = mt.source_id
JOIN "live_days" d ON d."liveSessionId" = os."id"
JOIN "live_sessions" ns ON ns."scheduleId" = mt.target_id
WHERE ns."id" = 'mig' || substr(md5('live:' || mt.target_id), 1, 22);

UPDATE "live_logs" lg SET "liveSessionId" = ns."id"
FROM "_mig_moves" m
JOIN "shifts" s ON s."id" = m.shift_id
JOIN "live_sessions" os ON os."scheduleId" = m.source_id
JOIN "live_sessions" ns ON ns."scheduleId" = s."scheduleId"
WHERE lg."shiftId" = m.shift_id AND lg."liveSessionId" = os."id";

-- Der Standort steht jetzt ausschliesslich am Plan.
ALTER TABLE "shifts" DROP CONSTRAINT "shifts_branchId_fkey";
ALTER TABLE "shifts" DROP COLUMN "branchId";

-- Ein Standort mit Plaenen darf nicht still verschwinden.
ALTER TABLE "schedules" DROP CONSTRAINT "schedules_branchId_fkey";
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- Freigaben, Personalzuordnung, Standortmeldungen --------------------
CREATE TABLE "branch_access" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "rights" "BranchRight"[] DEFAULT ARRAY[]::"BranchRight"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_access_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "branch_access_organizationId_branchId_idx" ON "branch_access"("organizationId", "branchId");
CREATE UNIQUE INDEX "branch_access_memberId_branchId_key" ON "branch_access"("memberId", "branchId");
ALTER TABLE "branch_access" ADD CONSTRAINT "branch_access_memberId_organizationId_fkey" FOREIGN KEY ("memberId", "organizationId") REFERENCES "organization_members"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_access" ADD CONSTRAINT "branch_access_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "branches"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "staff_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "managerMemberId" TEXT NOT NULL,
    "employeeMemberId" TEXT NOT NULL,
    "rights" "StaffRight"[] DEFAULT ARRAY[]::"StaffRight"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_assignments_organizationId_employeeMemberId_idx" ON "staff_assignments"("organizationId", "employeeMemberId");
CREATE UNIQUE INDEX "staff_assignments_managerMemberId_employeeMemberId_key" ON "staff_assignments"("managerMemberId", "employeeMemberId");
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_managerMemberId_organizationId_fkey" FOREIGN KEY ("managerMemberId", "organizationId") REFERENCES "organization_members"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_employeeMemberId_organizationId_fkey" FOREIGN KEY ("employeeMemberId", "organizationId") REFERENCES "organization_members"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "branch_issues" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeMemberId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "branch_issues_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "branch_issues_organizationId_branchId_status_idx" ON "branch_issues"("organizationId", "branchId", "status");
ALTER TABLE "branch_issues" ADD CONSTRAINT "branch_issues_branchId_organizationId_fkey" FOREIGN KEY ("branchId", "organizationId") REFERENCES "branches"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_issues" ADD CONSTRAINT "branch_issues_assigneeMemberId_fkey" FOREIGN KEY ("assigneeMemberId") REFERENCES "organization_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "branch_issues" ADD CONSTRAINT "branch_issues_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- Zeitbuchungen einem Standort zuordnen ------------------------------
-- Regel: Eine Zeitbuchung gehoert zu dem Standort der veroeffentlichten
-- Schicht, der die Person zugewiesen war und mit der sich die Buchung
-- zeitlich ueberschneidet (Ortszeit Europe/Berlin). Buchungen ohne
-- Uhrzeiten (reine Dauer) werden ueber den Kalendertag verglichen. Nur wenn
-- genau ein Standort in Frage kommt, wird er eingetragen; alles andere
-- bleibt ohne Standort und ist ausser fuer die Person selbst nur fuer
-- Admins sichtbar.
ALTER TABLE "time_records" ADD COLUMN "branchId" TEXT;
CREATE INDEX "time_records_organizationId_branchId_date_idx" ON "time_records"("organizationId", "branchId", "date");
ALTER TABLE "time_records" ADD CONSTRAINT "time_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH planned AS (
  SELECT b."userId" AS user_id, sc."organizationId" AS org, sc."branchId" AS branch_id,
         to_date(sc."year" || '-' || sc."weekNumber" || '-' || s."dayOfWeek", 'IYYY-IW-ID') AS shift_date,
         s."shiftFrom" AS shift_from, s."shiftTo" AS shift_to
  FROM "bookings" b
  JOIN "shifts" s ON s."id" = b."shiftId"
  JOIN "schedules" sc ON sc."id" = s."scheduleId"
  WHERE s."deletedAt" IS NULL AND sc."deletedAt" IS NULL AND sc."isPublic" AND sc."branchId" IS NOT NULL
), ranges AS (
  SELECT user_id, org, branch_id, shift_date,
         shift_date + shift_from::time AS shift_start,
         shift_date + shift_to::time + CASE WHEN shift_to <= shift_from THEN interval '1 day' ELSE interval '0' END AS shift_end
  FROM planned
), candidates AS (
  SELECT t."id", r.branch_id
  FROM "time_records" t
  JOIN ranges r ON r.user_id = t."userId" AND r.org = t."organizationId"
  WHERE CASE
    WHEN t."timeFrom" IS NOT NULL THEN
      t."date" + t."timeFrom"::time < r.shift_end
      AND r.shift_start < CASE
        WHEN t."timeTo" IS NULL THEN t."date" + t."timeFrom"::time + interval '1 minute'
        ELSE t."date" + t."timeTo"::time + CASE WHEN t."timeTo" <= t."timeFrom" THEN interval '1 day' ELSE interval '0' END
      END
    ELSE r.shift_date = t."date"
  END
), unique_branch AS (
  SELECT "id", min(branch_id) AS branch_id FROM candidates GROUP BY "id" HAVING count(DISTINCT branch_id) = 1
)
UPDATE "time_records" t SET "branchId" = u.branch_id FROM unique_branch u WHERE t."id" = u."id";

-- --- Organisationsweite Planansicht entfaellt ---------------------------
-- Ersetzt durch ausdrueckliche Standortfreigaben.
ALTER TABLE "organizations" DROP COLUMN "scheduleVisibility";
DROP TYPE "ScheduleVisibility";

-- --- Mandantentreue auf Datenbankebene ----------------------------------
-- Optionale Verweise (Plan->Standort, Standort->Kunde, Zeitbuchung->Standort,
-- Meldung->zustaendige Person) muessen in derselben Organisation liegen.
CREATE FUNCTION "akro_same_organization"() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  ref_id TEXT;
  ok BOOLEAN;
BEGIN
  ref_id := to_jsonb(NEW) ->> TG_ARGV[1];
  IF ref_id IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE "id" = $1 AND "organizationId" = $2)', TG_ARGV[0])
    INTO ok USING ref_id, NEW."organizationId";
  IF NOT ok THEN
    RAISE EXCEPTION 'Verweis %.% gehoert zu einer anderen Organisation.', TG_TABLE_NAME, TG_ARGV[1] USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "schedules_branch_same_organization" BEFORE INSERT OR UPDATE ON "schedules"
  FOR EACH ROW EXECUTE FUNCTION "akro_same_organization"('branches', 'branchId');
CREATE TRIGGER "branches_customer_same_organization" BEFORE INSERT OR UPDATE ON "branches"
  FOR EACH ROW EXECUTE FUNCTION "akro_same_organization"('customers', 'customerId');
CREATE TRIGGER "time_records_branch_same_organization" BEFORE INSERT OR UPDATE ON "time_records"
  FOR EACH ROW EXECUTE FUNCTION "akro_same_organization"('branches', 'branchId');
CREATE TRIGGER "branch_issues_assignee_same_organization" BEFORE INSERT OR UPDATE ON "branch_issues"
  FOR EACH ROW EXECUTE FUNCTION "akro_same_organization"('organization_members', 'assigneeMemberId');

COMMIT;
