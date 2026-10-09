import { db } from "@/lib/db";

/**
 * Datenschutz-Schalter: KI-Funktionen senden Daten an einen externen Dienst
 * (Anthropic, USA). Sie bleiben aus, solange AI_ENABLED nicht explizit "true" ist.
 */
export function isAIAllowedByServer(): boolean {
  return process.env.AI_ENABLED === "true";
}

/**
 * Selbstregistrierung ist nur fuer die Ersteinrichtung offen (noch keine
 * Organisation vorhanden) oder wenn ALLOW_REGISTRATION explizit "true" ist.
 * Mitarbeiter werden danach ausschliesslich von Admins angelegt.
 */
export async function isRegistrationOpen(): Promise<boolean> {
  if (process.env.ALLOW_REGISTRATION === "true") return true;
  const orgCount = await db.organization.count();
  return orgCount === 0;
}

export { PASSWORD_HINT, PASSWORD_MIN_LENGTH, passwordSchema } from "@/lib/security-shared";
