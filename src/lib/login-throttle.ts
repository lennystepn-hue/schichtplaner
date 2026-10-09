/**
 * Schutz gegen Passwort-Raten (Brute Force) beim Login.
 *
 * Pro E-Mail-Adresse sind 5 Fehlversuche in 15 Minuten erlaubt. Danach ist
 * die Anmeldung fuer diese Adresse 15 Minuten gesperrt, auch mit richtigem
 * Passwort. Ein erfolgreicher Login setzt den Zaehler zurueck.
 *
 * Bewusst im Arbeitsspeicher: Beim Neustart der App ist alles zurueckgesetzt.
 * Das reicht fuer eine selbst gehostete Installation mit einem App-Container.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000; // 15 Minuten

/** E-Mail (klein geschrieben) -> Zeitpunkte der Fehlversuche (epoch ms). */
const failures = new Map<string, number[]>();

function recentFailures(key: string, now: number): number[] {
  const cutoff = now - WINDOW_MS;
  const pruned = (failures.get(key) ?? []).filter((t) => t > cutoff);
  if (pruned.length > 0) {
    failures.set(key, pruned);
  } else {
    failures.delete(key);
  }
  return pruned;
}

/** true, wenn fuer diese Adresse aktuell zu viele Fehlversuche vorliegen. */
export function isLoginBlocked(email: string): boolean {
  const key = email.toLowerCase();
  return recentFailures(key, Date.now()).length >= MAX_ATTEMPTS;
}

/** Fehlversuch merken. */
export function recordLoginFailure(email: string): void {
  const key = email.toLowerCase();
  const now = Date.now();
  const attempts = recentFailures(key, now);
  attempts.push(now);
  failures.set(key, attempts);
}

/** Nach erfolgreicher Anmeldung den Zaehler leeren. */
export function clearLoginFailures(email: string): void {
  failures.delete(email.toLowerCase());
}
