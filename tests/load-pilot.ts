/*
 * Lasttest fuer den internen Pilotbetrieb (rund 20 Mitarbeitende).
 *
 * Der Test laeuft ausschliesslich gegen eine ausdruecklich konfigurierte
 * Testumgebung. Es gibt keine Standardadresse und keine Zugangsdaten im
 * Quelltext; fehlt etwas, bricht der Lauf mit einer Meldung ab. Benutzer
 * werden nie angelegt - es werden nur vorhandene Testkonten verwendet.
 */
import { io, type Socket } from "socket.io-client";
import { berlinDate, isoWeek } from "../src/lib/berlin";

// ---------------------------------------------------------------------------
// Konfiguration - ausschliesslich ueber Umgebungsvariablen
// ---------------------------------------------------------------------------

function zahl(name: string, standard: number): number {
  const wert = process.env[name];
  if (wert === undefined || wert.trim() === "") return standard;
  const n = Number(wert);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${name} muss eine positive Zahl sein, gelesen wurde: ${wert}`);
    process.exit(1);
  }
  return n;
}

const BASIS = (process.env.LOAD_BASE_URL ?? "").replace(/\/+$/, "");
const PASSWORT = process.env.LOAD_USER_PASSWORD ?? "";
const PRAEFIX = process.env.LOAD_USER_PREFIX || "load-user-";
const NUTZER = Math.floor(zahl("LOAD_USERS", 30));
const DAUER_MINUTEN = zahl("LOAD_DURATION_MINUTES", 15);
const SPITZE = Math.floor(zahl("LOAD_SPIKE_USERS", 40));
const SCHREIBEN_ERLAUBT = (process.env.LOAD_ALLOW_WRITES ?? "false").toLowerCase() === "true";

/** Nennplan des Lasttests; kuerzere Laufzeiten verkuerzen ihn anteilig. */
const PHASEN = [
  { name: "Phase 1", minuten: 2, nutzer: () => 5 },
  { name: "Phase 2", minuten: 3, nutzer: () => 15 },
  { name: "Phase 3", minuten: 10, nutzer: () => NUTZER },
  { name: "Phase 4", minuten: 2, nutzer: () => SPITZE },
];
const NENNDAUER_MINUTEN = PHASEN.reduce((summe, p) => summe + p.minuten, 0);

/** Endpunkte, deren p95 als normaler Lesezugriff bewertet wird. */
const LESEN = [
  "/api/me",
  "/api/dashboard",
  "/api/schedules",
  "/api/messages/unread-count",
];
/** Endpunkte, deren p95 als Schreibzugriff bewertet wird. */
const SCHREIBEN = [
  "/api/bookings (PATCH)",
  "/api/mod-requests (POST)",
  "/api/messages (POST)",
];

const GRENZE_FEHLERQUOTE = 1; // Prozent
const GRENZE_P95_LESEN = 800; // Millisekunden
const GRENZE_P95_SCHREIBEN = 1500; // Millisekunden
const PAUSE_MIN = 15_000;
const PAUSE_MAX = 45_000;
/** Hoechstzahl Schreibvorgaenge je simuliertem Benutzer im ganzen Lauf. */
const SCHREIBGRENZE = 2;

function pruefeKonfiguration(): void {
  const fehlt: string[] = [];
  if (!BASIS) fehlt.push("LOAD_BASE_URL");
  if (!PASSWORT) fehlt.push("LOAD_USER_PASSWORD");
  if (fehlt.length) {
    console.error("Der Lasttest wurde nicht gestartet. Es fehlen diese Umgebungsvariablen:");
    for (const name of fehlt) console.error("  - " + name);
    console.error("");
    console.error("Beispiel:");
    console.error('  LOAD_BASE_URL="https://dienstplan.test.example" LOAD_USER_PASSWORD="…" npm run test:load:pilot');
    console.error("Niemals gegen die Produktivumgebung testen.");
    process.exit(1);
  }
  let adresse: URL;
  try {
    adresse = new URL(BASIS);
  } catch {
    console.error(`LOAD_BASE_URL ist keine gueltige Adresse: ${BASIS}`);
    process.exit(1);
  }
  if (adresse.protocol !== "http:" && adresse.protocol !== "https:") {
    console.error(`LOAD_BASE_URL muss http oder https verwenden, gelesen wurde: ${adresse.protocol}`);
    process.exit(1);
  }
}

/** Baut die Adresse eines Testkontos, z. B. load-user-001@akro-test.invalid */
function kontoAdresse(nummer: number): string {
  const n = String(nummer).padStart(3, "0");
  const at = PRAEFIX.indexOf("@");
  if (at >= 0) return PRAEFIX.slice(0, at) + n + PRAEFIX.slice(at);
  return PRAEFIX + n + "@akro-test.invalid";
}

// ---------------------------------------------------------------------------
// Messwerte
// ---------------------------------------------------------------------------

type Messreihe = { anfragen: number; fehler: number; dauern: number[] };

const messung = new Map<string, Messreihe>();

function reihe(endpunkt: string): Messreihe {
  let vorhanden = messung.get(endpunkt);
  if (!vorhanden) {
    vorhanden = { anfragen: 0, fehler: 0, dauern: [] };
    messung.set(endpunkt, vorhanden);
  }
  return vorhanden;
}

function erfasse(endpunkt: string, dauer: number, erfolg: boolean): void {
  const r = reihe(endpunkt);
  r.anfragen++;
  if (erfolg) r.dauern.push(dauer);
  else r.fehler++;
}

const zaehler = {
  loginsOk: 0,
  loginsFehler: 0,
  socketsOk: 0,
  socketsFehler: 0,
  socketsGeplant: 0,
  socketAbbrueche: 0,
  schreibvorgaenge: 0,
  authFehler: 0,
  mandantFehler: 0,
};

/** Nearest-Rank-Perzentil auf einer bereits sortierten Liste. */
function perzentil(sortiert: number[], anteil: number): number {
  if (sortiert.length === 0) return 0;
  const rang = Math.ceil(anteil * sortiert.length);
  return sortiert[Math.min(sortiert.length - 1, Math.max(0, rang - 1))];
}

function ms(wert: number): string {
  return wert === 0 ? "-" : Math.round(wert) + " ms";
}

// ---------------------------------------------------------------------------
// Simulierter Benutzer
// ---------------------------------------------------------------------------

type Buchung = { userId: string; confirmedAt: string | null };
type Schicht = { id: string; bookings: Buchung[] };
type Plan = { schedule?: { id: string; shifts?: Schicht[] } };
type Konto = { organizationId?: string; organizationName?: string; user?: { id: string } };

class Nutzer {
  private jar = new Map<string, string>();
  private socket: Socket | null = null;
  /** Solange gesetzt, gehoert der Benutzer zur laufenden Phase. */
  aktiv = false;
  private wecker: (() => void) | null = null;
  private schleife: Promise<void> | null = null;
  private geschrieben = 0;
  orgId = "";
  orgName = "";
  userId = "";

  constructor(readonly email: string) {}

  private cookieKopf(): string {
    return [...this.jar].map(([k, v]) => k + "=" + v).join("; ");
  }

  private merkeCookies(res: Response): void {
    for (const cookie of res.headers.getSetCookie()) {
      const paar = cookie.split(";")[0];
      const index = paar.indexOf("=");
      if (index > 0) this.jar.set(paar.slice(0, index), paar.slice(index + 1));
    }
  }

  /** Eine gemessene Anfrage. Gibt den Rumpf zurueck oder null bei Fehler. */
  async anfrage<T>(endpunkt: string, pfad: string, method = "GET", data?: unknown): Promise<T | null> {
    const start = performance.now();
    try {
      const res = await fetch(BASIS + pfad, {
        method,
        redirect: "manual",
        headers: { Cookie: this.cookieKopf(), "Content-Type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      this.merkeCookies(res);
      const text = await res.text();
      const dauer = performance.now() - start;
      const erfolg = res.status >= 200 && res.status < 300;
      if (!erfolg) {
        // 401/403 und die Umleitung auf die Anmeldung sind Zugriffsfehler,
        // kein normales Lastergebnis.
        if (res.status === 401 || res.status === 403 || res.status === 307) zaehler.authFehler++;
        erfasse(endpunkt, dauer, false);
        return null;
      }
      erfasse(endpunkt, dauer, true);
      if (!res.headers.get("content-type")?.includes("json")) return null;
      return JSON.parse(text) as T;
    } catch {
      erfasse(endpunkt, performance.now() - start, false);
      return null;
    }
  }

  /** Anmeldung ueber den Anmeldedienst der Anwendung. */
  async anmelden(): Promise<boolean> {
    const start = performance.now();
    try {
      const csrfRes = await fetch(BASIS + "/api/auth/csrf", {
        headers: { Cookie: this.cookieKopf() },
      });
      this.merkeCookies(csrfRes);
      const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
      const res = await fetch(BASIS + "/api/auth/callback/credentials", {
        method: "POST",
        redirect: "manual",
        headers: {
          Cookie: this.cookieKopf(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          csrfToken,
          email: this.email,
          password: PASSWORT,
          callbackUrl: BASIS + "/dashboard",
        }),
      });
      this.merkeCookies(res);
      const sitzungRes = await fetch(BASIS + "/api/auth/session", {
        headers: { Cookie: this.cookieKopf() },
      });
      this.merkeCookies(sitzungRes);
      const sitzung = (await sitzungRes.json()) as { user?: { email?: string } };
      const ok = sitzung.user?.email === this.email;
      erfasse("Login", performance.now() - start, ok);
      if (ok) zaehler.loginsOk++;
      else zaehler.loginsFehler++;
      return ok;
    } catch {
      erfasse("Login", performance.now() - start, false);
      zaehler.loginsFehler++;
      return false;
    }
  }

  /** Liest die eigene Mitgliedschaft; liefert false, wenn sie fehlt. */
  async ladeKonto(): Promise<boolean> {
    const konto = await this.anfrage<Konto>("/api/me", "/api/me");
    if (!konto?.organizationId || !konto.user?.id) return false;
    this.orgId = konto.organizationId;
    this.orgName = konto.organizationName ?? "";
    this.userId = konto.user.id;
    return true;
  }

  private async verbinde(): Promise<void> {
    zaehler.socketsGeplant++;
    const start = performance.now();
    const verbindung = io(BASIS, {
      path: "/api/ws",
      transports: ["websocket", "polling"],
      extraHeaders: { Cookie: this.cookieKopf() },
      // Kein automatischer Neuaufbau: unerwartete Abbrueche sollen sichtbar
      // bleiben und nicht stillschweigend geheilt werden.
      reconnection: false,
      timeout: 20_000,
    });
    this.socket = verbindung;
    const verbunden = await new Promise<boolean>((auf) => {
      const fertig = (wert: boolean) => {
        verbindung.off("connect", beiVerbindung);
        verbindung.off("connect_error", beiFehler);
        auf(wert);
      };
      const beiVerbindung = () => fertig(true);
      const beiFehler = () => fertig(false);
      verbindung.once("connect", beiVerbindung);
      verbindung.once("connect_error", beiFehler);
    });
    erfasse("Socket.IO", performance.now() - start, verbunden);
    if (!verbunden) {
      zaehler.socketsFehler++;
      verbindung.close();
      this.socket = null;
      return;
    }
    zaehler.socketsOk++;
    // Eigener Organisationsraum - der Server prueft die Zugehoerigkeit.
    verbindung.emit("join:org", this.orgId);
    verbindung.on("disconnect", () => {
      if (this.aktiv) zaehler.socketAbbrueche++;
    });
  }

  private async trenne(): Promise<void> {
    const verbindung = this.socket;
    this.socket = null;
    if (!verbindung) return;
    verbindung.removeAllListeners("disconnect");
    verbindung.close();
  }

  /** Ein Lesedurchgang, wie ihn ein geoeffnetes Fenster erzeugt. */
  private async durchgang(): Promise<void> {
    const konto = await this.anfrage<Konto>("/api/me", "/api/me");
    // Mandantentrennung: die Antwort muss zur eigenen Organisation gehoeren.
    if (konto && konto.organizationId !== this.orgId) zaehler.mandantFehler++;
    if (!this.aktiv) return;
    await this.anfrage("/api/dashboard", "/api/dashboard");
    if (!this.aktiv) return;
    const woche = isoWeek(berlinDate());
    const plan = await this.anfrage<Plan>(
      "/api/schedules",
      `/api/schedules?kw=${woche.weekNumber}&year=${woche.year}`
    );
    if (!this.aktiv) return;
    await this.anfrage("/api/messages/unread-count", "/api/messages/unread-count");
    if (darfSchreiben() && this.geschrieben < SCHREIBGRENZE && this.aktiv) {
      await this.schreibe(plan);
    }
  }

  /**
   * Genau ein kontrollierter Schreibvorgang: eigene Schicht bestaetigen,
   * eigenen Antrag stellen oder eine Nachricht an ein anderes Testkonto.
   * Fremde Schichten, Einstellungen und Stammdaten bleiben unberuehrt.
   */
  private async schreibe(plan: Plan | null): Promise<void> {
    const schichten = plan?.schedule?.shifts ?? [];
    const eigene = schichten.filter((s) => s.bookings?.some((b) => b.userId === this.userId));
    const unbestaetigt = eigene.find((s) =>
      s.bookings.some((b) => b.userId === this.userId && !b.confirmedAt)
    );

    if (unbestaetigt) {
      const ok = await this.anfrage("/api/bookings (PATCH)", "/api/bookings", "PATCH", {
        shiftId: unbestaetigt.id,
      });
      if (ok !== null) this.zaehleSchreiben();
      return;
    }
    if (eigene.length > 0) {
      const ok = await this.anfrage("/api/mod-requests (POST)", "/api/mod-requests", "POST", {
        shiftId: eigene[0].id,
        kind: "SWAP",
      });
      if (ok !== null) this.zaehleSchreiben();
      return;
    }
    const empfaenger = anderesTestkonto(this.userId);
    if (!empfaenger) return;
    const ok = await this.anfrage("/api/messages (POST)", "/api/messages", "POST", {
      subject: "Lasttest",
      body: "Automatisch erzeugte Testnachricht des Pilot-Lasttests.",
      recipientIds: [empfaenger],
    });
    if (ok !== null) this.zaehleSchreiben();
  }

  private zaehleSchreiben(): void {
    this.geschrieben++;
    zaehler.schreibvorgaenge++;
  }

  /** Startet Verbindung und Leseschleife des Benutzers. */
  starte(): void {
    if (this.aktiv) return;
    this.aktiv = true;
    this.schleife = (async () => {
      await this.verbinde();
      while (this.aktiv) {
        await this.durchgang();
        if (!this.aktiv) break;
        await this.warte(PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN));
      }
      await this.trenne();
    })();
  }

  /** Beendet den Benutzer geordnet und wartet auf das Ende der Schleife. */
  async stoppe(): Promise<void> {
    if (!this.aktiv) return;
    this.aktiv = false;
    this.wecker?.();
    const laufend = this.schleife;
    this.schleife = null;
    await laufend;
  }

  /** Abbrechbare Pause mit Jitter, damit nicht alle gleichzeitig abfragen. */
  private warte(dauer: number): Promise<void> {
    return new Promise<void>((auf) => {
      const uhr = setTimeout(() => {
        this.wecker = null;
        auf();
      }, dauer);
      this.wecker = () => {
        clearTimeout(uhr);
        this.wecker = null;
        auf();
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Testumgebung und Schreibfreigabe
// ---------------------------------------------------------------------------

const nutzer: Nutzer[] = [];
let testumgebung = false;
let schreibgrund = "";

function darfSchreiben(): boolean {
  return SCHREIBEN_ERLAUBT && testumgebung;
}

function anderesTestkonto(eigeneId: string): string | null {
  const andere = nutzer.find((n) => n.userId && n.userId !== eigeneId);
  return andere?.userId ?? null;
}

/**
 * Eine Umgebung gilt nur dann als Testumgebung, wenn alle verwendeten Konten
 * auf der reservierten Endung .invalid liegen und die Organisation sich
 * selbst als Test kennzeichnet. Sonst wird nicht geschrieben.
 */
function pruefeTestumgebung(): void {
  const alleUngueltig = nutzer.every((n) => n.email.toLowerCase().endsWith(".invalid"));
  const orgName = nutzer[0]?.orgName ?? "";
  const heisstTest = /test|pilot|staging/i.test(orgName);
  const eineOrganisation = new Set(nutzer.map((n) => n.orgId)).size === 1;
  testumgebung = alleUngueltig && heisstTest && eineOrganisation;
  if (testumgebung) return;
  if (!alleUngueltig) schreibgrund = "Testkonten liegen nicht auf der reservierten Endung .invalid";
  else if (!eineOrganisation) schreibgrund = "Die Konten gehoeren zu mehreren Organisationen";
  else schreibgrund = `Die Organisation "${orgName}" ist nicht als Testorganisation erkennbar`;
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

function schlafe(dauer: number): Promise<void> {
  return new Promise<void>((auf) => {
    setTimeout(auf, dauer);
  });
}

/** Wird durch SIGINT/SIGTERM gesetzt und bricht den Lauf geordnet ab. */
let abbruch = false;

/** Weckt eine laufende Phase vorzeitig, sobald ein Signal eintrifft. */
let phasenWecker: (() => void) | null = null;

function phasenPause(dauer: number): Promise<void> {
  return new Promise<void>((auf) => {
    const uhr = setTimeout(() => {
      phasenWecker = null;
      auf();
    }, dauer);
    phasenWecker = () => {
      clearTimeout(uhr);
      phasenWecker = null;
      auf();
    };
  });
}

/** Meldet alle benoetigten Konten an; fehlende werden benannt. */
async function anmeldung(anzahl: number): Promise<string[]> {
  const fehlend: string[] = [];
  const gleichzeitig = 5;
  for (let start = 0; start < anzahl; start += gleichzeitig) {
    const gruppe = nutzer.slice(start, start + gleichzeitig);
    await Promise.all(
      gruppe.map(async (n) => {
        if (!(await n.anmelden()) || !(await n.ladeKonto())) fehlend.push(n.email);
      })
    );
  }
  return fehlend;
}

async function setzeZielzahl(ziel: number): Promise<void> {
  const aktive = nutzer.filter((n) => n.aktiv);
  if (aktive.length < ziel) {
    for (const n of nutzer) {
      if (abbruch) break;
      if (nutzer.filter((x) => x.aktiv).length >= ziel) break;
      if (!n.aktiv) {
        n.starte();
        // Gestaffelter Anlauf statt gleichzeitigem Einstieg aller Clients.
        await schlafe(150);
      }
    }
    return;
  }
  const zuViel = aktive.slice(ziel);
  await Promise.all(zuViel.map((n) => n.stoppe()));
}

function tabelle(): void {
  const zeilen = [...LESEN, ...SCHREIBEN, "Login", "Socket.IO"].filter((endpunkt) =>
    messung.has(endpunkt)
  );
  const breite = Math.max(28, ...zeilen.map((z) => z.length + 2));
  const kopf =
    "Endpoint".padEnd(breite) +
    "Requests".padStart(9) +
    "Fehler".padStart(8) +
    "p50".padStart(10) +
    "p95".padStart(10) +
    "p99".padStart(10) +
    "Max".padStart(10);
  console.log("");
  console.log(kopf);
  console.log("-".repeat(kopf.length));
  for (const endpunkt of zeilen) {
    const r = reihe(endpunkt);
    const sortiert = [...r.dauern].sort((a, b) => a - b);
    console.log(
      endpunkt.padEnd(breite) +
        String(r.anfragen).padStart(9) +
        String(r.fehler).padStart(8) +
        ms(perzentil(sortiert, 0.5)).padStart(10) +
        ms(perzentil(sortiert, 0.95)).padStart(10) +
        ms(perzentil(sortiert, 0.99)).padStart(10) +
        ms(sortiert[sortiert.length - 1] ?? 0).padStart(10)
    );
  }
}

function bewerte(laufzeitMs: number): string[] {
  const gruende: string[] = [];
  let anfragen = 0;
  let fehler = 0;
  let schnellste = Number.POSITIVE_INFINITY;
  let summe = 0;
  let werte = 0;
  for (const [endpunkt, r] of messung) {
    if (endpunkt === "Socket.IO") continue;
    anfragen += r.anfragen;
    fehler += r.fehler;
    for (const d of r.dauern) {
      schnellste = Math.min(schnellste, d);
      summe += d;
      werte++;
    }
  }
  const quote = anfragen === 0 ? 0 : (fehler / anfragen) * 100;

  console.log("");
  console.log("Anfragen gesamt          " + anfragen);
  console.log("davon erfolgreich        " + (anfragen - fehler));
  console.log("davon fehlgeschlagen     " + fehler);
  console.log("Fehlerquote              " + quote.toFixed(2) + " %");
  console.log("Antwortzeit Minimum      " + ms(werte ? schnellste : 0));
  console.log("Antwortzeit Durchschnitt " + ms(werte ? summe / werte : 0));
  console.log("Logins erfolgreich       " + zaehler.loginsOk);
  console.log("Logins fehlgeschlagen    " + zaehler.loginsFehler);
  console.log("Socket-Verbindungen      " + zaehler.socketsOk + " von " + zaehler.socketsGeplant);
  console.log("Socket-Verbindungsfehler " + zaehler.socketsFehler);
  console.log("Unerwartete Abbrueche    " + zaehler.socketAbbrueche);
  console.log("Schreibvorgaenge         " + zaehler.schreibvorgaenge);
  console.log("Testdauer                " + (laufzeitMs / 60_000).toFixed(1) + " Minuten");

  if (anfragen === 0) gruende.push("Es wurde keine einzige Anfrage ausgefuehrt.");
  if (quote >= GRENZE_FEHLERQUOTE) {
    gruende.push(`Fehlerquote ${quote.toFixed(2)} % liegt nicht unter ${GRENZE_FEHLERQUOTE} %.`);
  }
  for (const endpunkt of LESEN) {
    const r = messung.get(endpunkt);
    if (!r || r.dauern.length === 0) continue;
    const p95 = perzentil([...r.dauern].sort((a, b) => a - b), 0.95);
    if (p95 >= GRENZE_P95_LESEN) {
      gruende.push(`p95 von ${endpunkt} betraegt ${Math.round(p95)} ms (Grenze ${GRENZE_P95_LESEN} ms).`);
    }
  }
  for (const endpunkt of SCHREIBEN) {
    const r = messung.get(endpunkt);
    if (!r || r.dauern.length === 0) continue;
    const p95 = perzentil([...r.dauern].sort((a, b) => a - b), 0.95);
    if (p95 >= GRENZE_P95_SCHREIBEN) {
      gruende.push(`p95 von ${endpunkt} betraegt ${Math.round(p95)} ms (Grenze ${GRENZE_P95_SCHREIBEN} ms).`);
    }
  }
  if (zaehler.socketsFehler > 0 || zaehler.socketsOk < zaehler.socketsGeplant) {
    gruende.push(
      `Nur ${zaehler.socketsOk} von ${zaehler.socketsGeplant} Socket-Verbindungen kamen zustande.`
    );
  }
  if (zaehler.socketAbbrueche > 0) {
    gruende.push(`${zaehler.socketAbbrueche} unerwartete Socket-Abbrueche.`);
  }
  if (zaehler.authFehler > 0) {
    gruende.push(`${zaehler.authFehler} Antworten mit Authentifizierungsfehler (401/403/Umleitung).`);
  }
  if (zaehler.mandantFehler > 0) {
    gruende.push(`${zaehler.mandantFehler} Antworten aus einer fremden Organisation.`);
  }
  // Ein Schreibtest ohne einen einzigen Schreibvorgang hat nichts belegt.
  if (SCHREIBEN_ERLAUBT && zaehler.schreibvorgaenge === 0) {
    gruende.push(
      testumgebung
        ? "LOAD_ALLOW_WRITES=true, aber kein einziger Schreibvorgang war erfolgreich. Haben die Testkonten Schichten in der laufenden Woche?"
        : `LOAD_ALLOW_WRITES=true, aber Schreibtests wurden abgelehnt: ${schreibgrund}.`
    );
  }
  return gruende;
}

async function main(): Promise<void> {
  pruefeKonfiguration();

  const benoetigt = Math.max(NUTZER, SPITZE, 5);
  for (let i = 1; i <= benoetigt; i++) nutzer.push(new Nutzer(kontoAdresse(i)));

  console.log(`Ziel:        ${BASIS}`);
  console.log(`Konten:      ${benoetigt} (${nutzer[0].email} … ${nutzer[benoetigt - 1].email})`);
  console.log(`Laufzeit:    ${DAUER_MINUTEN} Minuten (Nennplan ${NENNDAUER_MINUTEN} Minuten)`);
  console.log("");
  console.log("Melde Testkonten an …");

  const fehlend = await anmeldung(benoetigt);
  if (fehlend.length) {
    console.error("");
    console.error("Diese Testkonten konnten sich nicht anmelden:");
    for (const email of fehlend) console.error("  - " + email);
    console.error("");
    console.error("Der Lasttest legt keine Benutzer an. Lege die Konten in der");
    console.error("Testorganisation an oder passe LOAD_USER_PREFIX an.");
    process.exitCode = 1;
    return;
  }

  pruefeTestumgebung();
  console.log(`Organisation: ${nutzer[0].orgName}`);
  if (SCHREIBEN_ERLAUBT && !testumgebung) {
    console.log(`Schreibtests abgelehnt: ${schreibgrund}.`);
  } else if (SCHREIBEN_ERLAUBT) {
    console.log("Schreibtests aktiv: nur eigene Schicht, eigener Antrag, Testnachricht.");
  } else {
    console.log("Schreibtests aus (LOAD_ALLOW_WRITES=false).");
  }

  const faktor = DAUER_MINUTEN / NENNDAUER_MINUTEN;
  const start = performance.now();
  const beiSignal = () => {
    abbruch = true;
    // Laufende Phase sofort beenden, statt Minuten abzuwarten.
    phasenWecker?.();
    console.log("\nSignal empfangen - Phase wird abgebrochen, Verbindungen werden abgebaut …");
  };
  process.once("SIGINT", beiSignal);
  process.once("SIGTERM", beiSignal);

  for (const phase of PHASEN) {
    if (abbruch) break;
    const ziel = Math.max(1, Math.min(phase.nutzer(), nutzer.length));
    const dauer = Math.max(10_000, phase.minuten * faktor * 60_000);
    console.log(
      `\n${phase.name}: ${ziel} Nutzer für ${(dauer / 60_000).toFixed(1)} Minuten`
    );
    await setzeZielzahl(ziel);
    if (abbruch) break;
    await phasenPause(dauer);
  }

  console.log("\nPhase 5: Verbindungen abbauen …");
  await Promise.all(nutzer.map((n) => n.stoppe()));
  process.off("SIGINT", beiSignal);
  process.off("SIGTERM", beiSignal);

  const laufzeit = performance.now() - start;
  tabelle();
  const gruende = bewerte(laufzeit);
  console.log("");
  if (gruende.length === 0 && !abbruch) {
    console.log("Ergebnis: BESTANDEN");
    return;
  }
  console.log("Ergebnis: NICHT BESTANDEN");
  console.log("Gründe:");
  if (abbruch) console.log("- Der Lauf wurde vorzeitig abgebrochen.");
  for (const grund of gruende) console.log("- " + grund);
  process.exitCode = 1;
}

main().catch((fehler) => {
  console.error(fehler);
  process.exitCode = 1;
});
