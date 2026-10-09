BEGIN;
ALTER TABLE "organization_members" ADD COLUMN "activationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "position" TEXT, ADD COLUMN "employmentType" TEXT NOT NULL DEFAULT 'Vollzeit',
  ADD COLUMN "targetHoursPerWeek" DOUBLE PRECISION NOT NULL DEFAULT 40,
  ADD COLUMN "qualifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "branches" ADD COLUMN "meetingPoint" TEXT, ADD COLUMN "notes" TEXT,
  ADD COLUMN "positions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "shifts" ADD COLUMN "branchId" TEXT,
  ADD COLUMN "requiredQualifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD CONSTRAINT "shifts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "mod_requests" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TAKEOVER', ADD COLUMN "targetUserId" TEXT;
-- Repair pre-existing schema drift: the original migration omitted this field.
ALTER TABLE "mod_requests" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "messages" ADD COLUMN "shiftId" TEXT,
  ADD CONSTRAINT "messages_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "time_records" ADD COLUMN "organizationId" TEXT, ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "endedAt" TIMESTAMP(3), ADD COLUMN "pauseStartedAt" TIMESTAMP(3), ADD COLUMN "breakSeconds" INTEGER NOT NULL DEFAULT 0;
-- A category is authoritative. Without one, only an unambiguous membership may be used.
UPDATE "time_records" t SET "organizationId" = c."organizationId" FROM "time_categories" c WHERE t."categoryId" = c.id;
UPDATE "time_records" t SET "organizationId" = m.org FROM
  (SELECT "userId", min("organizationId") org FROM "organization_members" GROUP BY "userId" HAVING count(*) = 1) m
  WHERE t."userId" = m."userId" AND t."organizationId" IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "time_records" WHERE "organizationId" IS NULL) THEN
    RAISE EXCEPTION 'Zeitbuchungen ohne eindeutige Organisation vorhanden. Vor Migration manuell zuordnen; keine automatische Zuordnung.';
  END IF;
END $$;
UPDATE "time_records" SET "startedAt" = (("date"::text || ' ' || "timeFrom")::timestamp AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'UTC'
  WHERE "type" = 'WATCH' AND "timeFrom" IS NOT NULL;
UPDATE "time_records" SET "endedAt" = ((("date" + CASE WHEN "timeTo" < "timeFrom" THEN 1 ELSE 0 END)::text || ' ' || "timeTo")::timestamp AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'UTC'
  WHERE "type" = 'WATCH' AND "timeFrom" IS NOT NULL AND "timeTo" IS NOT NULL;
ALTER TABLE "time_records" ALTER COLUMN "organizationId" SET NOT NULL,
  ADD CONSTRAINT "time_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "time_records_organizationId_userId_date_idx" ON "time_records"("organizationId", "userId", "date");
CREATE TABLE "availabilities" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "date" DATE NOT NULL, "timeFrom" TEXT NOT NULL, "timeTo" TEXT NOT NULL, "available" BOOLEAN NOT NULL, "note" TEXT,
  CONSTRAINT "availabilities_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "organization_members"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "availabilities_organizationId_userId_date_idx" ON "availabilities"("organizationId", "userId", "date");
CREATE TABLE "time_corrections" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "recordId" TEXT NOT NULL, "requesterId" TEXT NOT NULL,
  "reason" TEXT NOT NULL, "before" JSONB NOT NULL, "proposed" JSONB NOT NULL,
  "status" "AbsenceStatus" NOT NULL DEFAULT 'PENDING', "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "time_corrections_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "time_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "time_corrections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "time_corrections_organizationId_status_idx" ON "time_corrections"("organizationId", "status");
COMMIT;
