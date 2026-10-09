/*
 * Legt die Daten fuer den Pilot-Lasttest an: Testkonten, einen Testkunden mit
 * Einsatzort, dessen veroeffentlichten Wochenplan und je eine Schicht pro Konto.
 *
 * Das Skript arbeitet nur in einer Organisation, die sich selbst als Test-,
 * Pilot- oder Staging-Umgebung ausweist, und nur mit Konten auf der
 * reservierten Endung .invalid. DATABASE_URL wird nicht aus einer .env
 * gelesen, sondern muss bewusst mitgegeben werden - so kann das Skript nicht
 * versehentlich die Produktivdatenbank treffen. Es loescht nichts.
 *
 * Mehrfaches Ausfuehren aendert nichts zusaetzlich (idempotent).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { berlinDate, isoWeek } from "../src/lib/berlin";

const DATENBANK = process.env.DATABASE_URL ?? "";
const PASSWORT = process.env.LOAD_USER_PASSWORD ?? "";
const PRAEFIX = process.env.LOAD_USER_PREFIX || "load-user-";
const ORG_NAME = process.env.LOAD_ORG_NAME ?? "";

function zahl(name: string, standard: number): number {
  const wert = process.env[name];
  if (wert === undefined || wert.trim() === "") return standard;
  const n = Number(wert);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : standard;
}

/** So viele Konten, wie der Lasttest in der Spitze braucht. */
const ANZAHL = Math.max(zahl("LOAD_USERS", 30), zahl("LOAD_SPIKE_USERS", 40));

const EINSATZORT = "Lasttest Objekt";
const KUNDE = "Lasttest Kunde";
const SCHICHT_TITEL = "Lasttest";
const SCHICHTZEITEN = [
  { dayOfWeek: 1, shiftFrom: "06:00", shiftTo: "14:00" },
  { dayOfWeek: 1, shiftFrom: "14:00", shiftTo: "22:00" },
  { dayOfWeek: 2, shiftFrom: "06:00", shiftTo: "14:00" },
  { dayOfWeek: 2, shiftFrom: "14:00", shiftTo: "22:00" },
  { dayOfWeek: 3, shiftFrom: "06:00", shiftTo: "14:00" },
  { dayOfWeek: 3, shiftFrom: "22:00", shiftTo: "06:00" },
  { dayOfWeek: 4, shiftFrom: "06:00", shiftTo: "14:00" },
  { dayOfWeek: 5, shiftFrom: "14:00", shiftTo: "22:00" },
];

function kontoAdresse(nummer: number): string {
  const n = String(nummer).padStart(3, "0");
  const at = PRAEFIX.indexOf("@");
  if (at >= 0) return PRAEFIX.slice(0, at) + n + PRAEFIX.slice(at);
  return PRAEFIX + n + "@akro-test.invalid";
}

/* Geordneter Abbruch: die Meldung wird am Ende ausgegeben, die
   Datenbankverbindung vorher geschlossen. */
class Abbruch extends Error {
  constructor(readonly zeilen: string[]) {
    super(zeilen[0]);
    this.name = "Abbruch";
  }
}

function abbruch(...zeilen: string[]): never {
  throw new Abbruch(zeilen);
}

function pruefeKonfiguration(): void {
  const fehlt: string[] = [];
  if (!DATENBANK) fehlt.push("DATABASE_URL");
  if (!PASSWORT) fehlt.push("LOAD_USER_PASSWORD");
  if (fehlt.length) {
    abbruch(
      "Es wurde nichts angelegt. Es fehlen diese Umgebungsvariablen:",
      ...fehlt.map((n) => "  - " + n),
      "",
      "DATABASE_URL muss auf die Datenbank der Testinstallation zeigen,",
      "niemals auf die Produktivdatenbank."
    );
  }
  const beispiel = kontoAdresse(1);
  if (!beispiel.toLowerCase().endsWith(".invalid")) {
    abbruch(
      `LOAD_USER_PREFIX wuerde die Adresse ${beispiel} erzeugen.`,
      "Testkonten muessen auf der reservierten Endung .invalid liegen."
    );
  }
  if (PASSWORT.length < 12) {
    console.warn(
      `Hinweis: Das Passwort hat nur ${PASSWORT.length} Zeichen. Die Anwendung verlangt sonst mindestens 12.`
    );
  }
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATENBANK }) });

/** Findet genau eine Organisation, die sich als Testumgebung ausweist. */
async function testOrganisation() {
  const kandidaten = await db.organization.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: "test", mode: "insensitive" } },
        { name: { contains: "pilot", mode: "insensitive" } },
        { name: { contains: "staging", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const gefiltert = ORG_NAME
    ? kandidaten.filter((o) => o.name === ORG_NAME)
    : kandidaten;

  if (gefiltert.length === 1) return gefiltert[0];

  if (gefiltert.length === 0) {
    abbruch(
      ORG_NAME
        ? `Keine Organisation mit dem Namen "${ORG_NAME}" gefunden, die als Testumgebung erkennbar ist.`
        : "Keine Organisation gefunden, deren Name Test, Pilot oder Staging enthaelt.",
      "",
      "Es wurde nichts angelegt. Lege in der Testinstallation eine Organisation",
      'an, deren Name das Wort "Test", "Pilot" oder "Staging" enthaelt.'
    );
  }
  abbruch(
    "Mehrere Organisationen kommen in Frage:",
    ...gefiltert.map((o) => "  - " + o.name),
    "",
    "Es wurde nichts angelegt. Waehle eine davon ueber LOAD_ORG_NAME aus."
  );
}

async function main(): Promise<void> {
  pruefeKonfiguration();

  const org = await testOrganisation();
  const woche = isoWeek(berlinDate());
  console.log(`Organisation: ${org.name}`);
  console.log(`Kalenderwoche: KW ${woche.weekNumber}/${woche.year}`);
  console.log(`Konten: ${ANZAHL} (${kontoAdresse(1)} … ${kontoAdresse(ANZAHL)})`);
  console.log("");

  const passwordHash = await bcrypt.hash(PASSWORT, 10);
  let neueKonten = 0;
  let aktualisierteKonten = 0;
  const benutzerIds: string[] = [];

  for (let i = 1; i <= ANZAHL; i++) {
    const email = kontoAdresse(i);
    const nummer = String(i).padStart(3, "0");
    const vorhanden = await db.user.findUnique({ where: { email }, select: { id: true } });

    const user = vorhanden
      ? await db.user.update({
          where: { id: vorhanden.id },
          // Das gemeinsame Testpasswort wird gesetzt, damit die Anmeldung
          // im Lasttest zuverlaessig funktioniert.
          data: { passwordHash },
          select: { id: true },
        })
      : await db.user.create({
          data: {
            email,
            passwordHash,
            firstName: "Last",
            lastName: "Test " + nummer,
            locale: "de",
          },
          select: { id: true },
        });
    if (vorhanden) aktualisierteKonten++;
    else neueKonten++;
    benutzerIds.push(user.id);

    await db.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: { isActive: true, isActivated: true, activationToken: null, role: "EMPLOYEE" },
      create: {
        organizationId: org.id,
        userId: user.id,
        role: "EMPLOYEE",
        isActive: true,
        isActivated: true,
        position: "Sicherheit",
        targetHoursPerWeek: 20,
      },
    });
  }
  console.log(`Konten neu angelegt:   ${neueKonten}`);
  console.log(`Konten aktualisiert:   ${aktualisierteKonten}`);

  // --- Kunde und Einsatzort (nur in der Testorganisation) ---
  const kunde = await db.customer.upsert({
    where: { organizationId_name: { organizationId: org.id, name: KUNDE } },
    create: { organizationId: org.id, name: KUNDE, notes: "Synthetische Daten für den Pilot-Lasttest." },
    update: {},
    select: { id: true },
  });
  let branch = await db.branch.findFirst({
    where: { organizationId: org.id, name: EINSATZORT },
    select: { id: true, customerId: true },
  });
  if (!branch) {
    branch = await db.branch.create({
      data: {
        organizationId: org.id,
        customerId: kunde.id,
        name: EINSATZORT,
        address: "Teststraße 1, 00000 Testort",
        meetingPoint: "Pforte",
        positions: ["Sicherheit"],
      },
      select: { id: true, customerId: true },
    });
    console.log(`Einsatzort angelegt:   ${EINSATZORT}`);
  } else if (!branch.customerId) {
    await db.branch.update({ where: { id: branch.id }, data: { customerId: kunde.id } });
  }

  // --- Wochenplan des Einsatzorts ---
  let schedule = await db.schedule.findFirst({
    where: {
      organizationId: org.id,
      weekNumber: woche.weekNumber,
      year: woche.year,
      branchId: branch.id,
      deletedAt: null,
    },
    select: { id: true, isPublic: true },
  });
  if (!schedule) {
    schedule = await db.schedule.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        weekNumber: woche.weekNumber,
        year: woche.year,
        isPublic: true,
      },
      select: { id: true, isPublic: true },
    });
    console.log("Wochenplan angelegt und veroeffentlicht");
  } else if (!schedule.isPublic) {
    // Ohne Veroeffentlichung sehen Mitarbeitende ihre Schichten nicht.
    await db.schedule.update({ where: { id: schedule.id }, data: { isPublic: true } });
    console.log("Vorhandener Wochenplan veroeffentlicht");
  }

  // --- Schichten ---
  const proSchicht = Math.ceil(ANZAHL / SCHICHTZEITEN.length);
  const vorhandeneSchichten = await db.shift.findMany({
    where: { scheduleId: schedule.id, title: SCHICHT_TITEL, deletedAt: null },
    select: { id: true, dayOfWeek: true, shiftFrom: true },
    orderBy: [{ dayOfWeek: "asc" }, { shiftFrom: "asc" }],
  });
  const schichtIds: string[] = [];
  let neueSchichten = 0;
  for (const zeit of SCHICHTZEITEN) {
    const treffer = vorhandeneSchichten.find(
      (s) => s.dayOfWeek === zeit.dayOfWeek && s.shiftFrom === zeit.shiftFrom
    );
    if (treffer) {
      schichtIds.push(treffer.id);
      continue;
    }
    const neu = await db.shift.create({
      data: {
        scheduleId: schedule.id,
        title: SCHICHT_TITEL,
        dayOfWeek: zeit.dayOfWeek,
        shiftFrom: zeit.shiftFrom,
        shiftTo: zeit.shiftTo,
        maxEmployees: proSchicht,
        pauseOption: "PER_SHIFT",
        pauseValue: 30,
      },
      select: { id: true },
    });
    schichtIds.push(neu.id);
    neueSchichten++;
  }
  console.log(`Schichten neu angelegt: ${neueSchichten} von ${SCHICHTZEITEN.length}`);

  // Genug Plaetze, falls die Kontozahl gewachsen ist.
  await db.shift.updateMany({
    where: { id: { in: schichtIds }, maxEmployees: { lt: proSchicht } },
    data: { maxEmployees: proSchicht },
  });

  // --- Zuweisungen: je Konto eine Schicht, unbestaetigt ---
  let neueBuchungen = 0;
  for (const [index, userId] of benutzerIds.entries()) {
    const shiftId = schichtIds[index % schichtIds.length];
    const vorhanden = await db.booking.findUnique({
      where: { shiftId_userId: { shiftId, userId } },
      select: { id: true },
    });
    if (vorhanden) {
      // Bestaetigung zuruecksetzen, damit der Schreibtest wieder etwas zu tun hat.
      await db.booking.update({ where: { id: vorhanden.id }, data: { confirmedAt: null } });
      continue;
    }
    await db.booking.create({ data: { shiftId, userId } });
    neueBuchungen++;
  }
  console.log(`Zuweisungen neu:       ${neueBuchungen} von ${benutzerIds.length}`);

  console.log("");
  console.log("Fertig. Der Lasttest kann jetzt gegen diese Installation laufen.");
}

main()
  .catch((fehler) => {
    if (fehler instanceof Abbruch) for (const zeile of fehler.zeilen) console.error(zeile);
    else console.error(fehler);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
