-- Datenschutz: KI-Funktionen standardmaessig deaktiviert (Opt-in)
ALTER TABLE "org_settings" ALTER COLUMN "aiEnabled" SET DEFAULT false,
ALTER COLUMN "aiAutoPlanner" SET DEFAULT false,
ALTER COLUMN "aiAnomalyDetection" SET DEFAULT false,
ALTER COLUMN "aiChatEnabled" SET DEFAULT false,
ALTER COLUMN "aiForecast" SET DEFAULT false,
ALTER COLUMN "aiSmartBriefing" SET DEFAULT false;

UPDATE "org_settings" SET "aiEnabled" = false;
