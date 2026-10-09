# AKRO Dienstplaner – Erweiterung und Übergabe

Stand: 24.09.2026. Abschnitte 1–4 beschreiben die Erweiterung vom 19.09.2026, Abschnitt 5 die
Trennung nach Kunde, Standort und Zuständigkeit vom 24.09.2026. Das bestehende Projekt wurde erweitert; kein neues Projekt erstellt.
Vorhandene lokale Änderungen wurden erhalten. Betriebsdaten wurden nicht migriert oder mit Testdaten überschrieben.

## 1. Analyse und ergänzte Funktionen

### Vorhandene Basis
Next.js 16 / React 19, PostgreSQL mit Prisma 7, NextAuth-Credentials,
React Query, shadcn/Tailwind und eigener Socket.IO-Server.
Bereits vorhanden: Wochen-/Monatsansichten, Arbeitsbereiche, Mitarbeiterverwaltung,
Abwesenheitsanträge, manuelle Zeiterfassung, Stoppuhr, Postfach und Auswertung.
Lücken waren insbesondere fehlende Einsatzortverknüpfung, Freigabeworkflows,
Pausenprotokollierung, Schichtbestätigungen und mandantensichere Zeitdaten.
Eine bestehende Abweichung zwischen Schema und Migration (`mod_requests.note`) wurde repariert.

### Dienstplanung
- Einsatzort, Arbeitsbereich, Tätigkeit, Hinweise und benötigte Qualifikationen im vorhandenen Schichtformular.
- Wiederholung für ausgewählte Wochentage über 1–52 Wochen. Die erzeugten Schichten bleiben einzeln bearbeitbar; keine zusätzliche Serienverwaltung.
- Kopie auf ein beliebiges Datum; Zuweisungen werden bewusst nicht kopiert.
- Entwurf bleibt für Mitarbeiter unsichtbar. Veröffentlichung informiert aktive Teammitglieder.
- Bestätigung eigener veröffentlichter Schichten. Änderungen setzen Bestätigungen zurück und informieren Betroffene.
- Zuweisung prüft Kapazität, aktive Mitgliedschaft, Qualifikationen, Tätigkeit am Einsatzort,
  Arbeitsbereichszugehörigkeit, genehmigte Abwesenheiten, Verfügbarkeit und Überschneidungen – auch nachts und über Jahresgrenzen.
- Konflikte werden serverseitig mit verständlicher Meldung abgewiesen.
- Mitarbeiter können sich nicht mehr direkt einbuchen: Übernahme und Tausch benötigen Freigabe.

### Personen und Orte
- Bestehende Personendetails um Tätigkeit, Beschäftigungsart, Wochen-Sollstunden,
  Qualifikationen und Aktivstatus erweitert.
- Einmaliger Einladungslink mit sieben Tagen Gültigkeit und Passwortaktivierung.
  Ein neuer Link macht den alten ungültig. Links werden durch die Administration weitergegeben; kein E-Mail-Versand eingerichtet.
- Einsatzorte mit Adresse, Treffpunkt, Tätigkeiten, Hinweisen und Aktivstatus
  direkt im vorhandenen Bereich für Arbeitsbereiche. Seit 24.09.2026 gehört jeder Einsatzort zu einem Kunden (Abschnitt 5).

### Verfügbarkeit, Abwesenheiten und Anträge
- Verfügbare/nicht verfügbare Zeitfenster im bestehenden Abwesenheitsbereich.
  Ohne Eintrag gilt eine Person grundsätzlich als verfügbar; positive Einträge begrenzen die angegebenen Tage.
- Bestehende Urlaubs-/Krankheits-/sonstige Kategorien weiterverwendet.
- Anträge und Entscheidungen erzeugen interne Benachrichtigungen.
- Tausch: eigene Schicht anbieten → geeigneter Kollege meldet sich → Administration genehmigt.
  Die ursprüngliche Zuweisung bleibt bis zur Genehmigung erhalten.
- Freigabe prüft Konflikte erneut und tauscht atomar. Keine doppelte Genehmigung.

### Zeit und Auswertung
- Arbeitsbeginn, Pause, Fortsetzen und Ende werden serverseitig gespeichert.
  Laufende Stoppuhr überlebt Neuladen; reale Zeitstempel berücksichtigen Zeitumstellungen.
- Korrekturantrag mit Begründung, Vorher-/Nachher-Daten und Freigabe.
  Zwischenzeitlich veränderte Datensätze können nicht unbemerkt überschrieben werden.
- Erfasste Zeiten werden nicht gelöscht; Korrekturen bleiben nachvollziehbar.
- Monatsauswertung enthält Soll, veröffentlichten Plan, tatsächliche Nettozeit und Ist-minus-Plan.
- CSV mit UTF-8-BOM, Semikolon, deutschen Dezimalwerten und Schutz gegen Tabellenformeln;
  lässt sich in Excel öffnen. Kein separater XLSX- oder PDF-Export.
- Sollberechnung: Wochenstunden / 5 × Montag–Freitag des Monats. Keine automatische Feiertags-,
  Urlaubs-, Tarif- oder Lohnabrechnung. Planvergleich umfasst den ganzen Monat einschließlich künftiger Schichten.
- Manuelle Von/Bis-Zeiten sind lokale Uhrzeiten; bei einer Zeitumstellung ist die reine Dauererfassung
  bzw. eine begründete Korrektur zu verwenden. Unveränderte Stoppuhr-Zeitstempel bleiben bei reiner Kommentarkorrektur erhalten.

### Kommunikation und Startseite
- Vorhandenes Postfach weiterverwendet: Einzel-/Teamnachrichten, Lesestatus und Schichtbezug.
- Systembenachrichtigungen sind echte Nachrichten in derselben Datenbank, keine Beispieldaten.
- Rollenabhängige Startseite: heutige/nächste Schichten, passende offene Schichten,
  fehlende Bestätigungen, Abwesenheiten, Anträge, Nachrichten und Monatsstunden.
- Blau-türkise Palette, mobile Karten/Formulare und reduzierte rollengerechte Navigation.
  Bestehende optionale KI-Seiten wurden nicht entfernt, aber aus der Hauptnavigation genommen.
- OWNER/ADMIN bleiben Administratoren. Seit 24.09.2026 planen Manager nur noch mit ausdrücklicher
  Freigabe je Standort und je zugeordneter Person (Abschnitt 5).

## 2. Geänderte Dateien

Die Liste betrifft diese Erweiterung; der Arbeitsbaum enthielt vorher bereits zahlreiche Designänderungen.

| Bereich | Dateien (relativ zum Projekt) |
| --- | --- |
| Datenbank | `prisma/schema.prisma`, `prisma/migrations/20260919090000_internal_workflows/migration.sql` |
| Gemeinsame Regeln | neue `src/lib/api.ts`, `berlin.ts`, `planning.ts`, `shift-service.ts`, `time-service.ts`, `report.ts` |
| Anmeldung/Infrastruktur | `src/lib/auth.ts`, `auth-helpers.ts`, `db.ts`, `socket.ts`, `utils/calendar.ts`; `src/i18n/request.ts`; `src/app/api/me/route.ts` |
| Planung-APIs | `src/app/api/schedules/route.ts`, `schedules/[id]/route.ts`, `schedules/[id]/briefing/route.ts`; `shifts/route.ts`, `shifts/[id]/route.ts`, neue `shifts/[id]/copy/route.ts`, `shifts/[id]/candidates/route.ts`; `bookings/route.ts`, `live/book/route.ts` |
| Anträge/Orte | neue `src/app/api/availability/route.ts`, `branches/route.ts`; `mod-requests/route.ts`, `mod-requests/[id]/route.ts`, `absences/route.ts`, `absences/[id]/route.ts` |
| Personal | `src/app/api/employees/route.ts`, `employees/[id]/route.ts`, neue `employees/[id]/invite/route.ts`, `auth/activate/route.ts` |
| Zeiten/Auswertung | `src/app/api/time/route.ts`, `time/[id]/route.ts`, `time/watch/route.ts`, neue `time/corrections/route.ts`; `reporting/route.ts`, `reporting/export/route.ts` |
| Dashboard/Nachrichten | neue `src/app/api/dashboard/route.ts`; `src/app/api/messages/route.ts` |
| Seiten/Design | `src/app/page.tsx`, `layout.tsx`, `globals.css`; `(auth)/login/page.tsx`, neue `(auth)/activate/page.tsx`; `(dashboard)/layout.tsx`, neue `(dashboard)/dashboard/page.tsx`; bestehende `(dashboard)/divisions/page.tsx`, `employees/absences/page.tsx`, `portal/inbox/page.tsx` |
| Neue integrierte UI | `src/components/workforce/{client,dashboard,requests,availability,locations,personnel}.tsx` |
| Bestehende UI | `src/components/layout/{top-nav,mobile-nav}.tsx`; `schedule/{shift-form,shift-card,employee-picker,schedule-options,live-mode}.tsx`; `employees/{employee-detail,absence-form}.tsx`; `divisions/division-form.tsx`; `time/{stopwatch,time-record-form,time-list}.tsx`; `reporting/{hours-table,export-modal}.tsx`; `portal/compose-message.tsx`; `src/types/schedule.ts` |
| Bestehende KI-Kompatibilität | `src/lib/ai/chat-tools.ts` nutzt zentrale Buchungsregeln und prüft Planungsrechte; kleine Lint-Korrekturen in `anomaly-detector.ts` und `employee-recommender.ts` |
| Tests/Dokumentation | `tests/workflows.ts`, `package.json`, `package-lock.json`, dieses Dokument |

## 3. Datenbank und Inbetriebnahme

### Additive Änderungen
- OrganizationMember: Aktivierungsablauf, Tätigkeit, Beschäftigungsart, Sollstunden, Qualifikationen.
- Branch: Treffpunkt, Hinweise, Tätigkeiten, Aktivstatus.
- Shift: Einsatzort-Fremdschlüssel und erforderliche Qualifikationen.
- Booking: Bestätigungszeitpunkt.
- ModRequest: Antragsart, übernehmende Person; fehlendes bestehendes Notizfeld nachgezogen.
- Message: optionaler Schichtbezug.
- TimeRecord: verpflichtende Organisationszuordnung, Beginn/Ende/Pausenbeginn als Zeitstempel, Pausensekunden.
- Neue Tabellen `availabilities` und `time_corrections` mit Fremdschlüsseln und Indizes.

Die Migration läuft in einer Transaktion. Alte Zeitdaten werden zuerst über ihre Kategorie,
sonst nur bei eindeutig einzelner Organisationsmitgliedschaft zugeordnet.
Bei mehrdeutigen Altbeständen bricht sie ab, statt Daten einer Organisation zu erraten.
Solche Fälle vor dem Rollout fachlich klären und eine kontrollierte Zuordnungsmigration vorbereiten.
Alte WATCH-Einträge werden aus Berliner Ortszeit in UTC-Zeitstempel überführt;
mehrdeutige Uhrzeiten am Winterzeitwechsel müssen fachlich geprüft werden.

### Vor dem produktiven Einsatz
1. PostgreSQL sichern und diese Migration zuerst auf einer Kopie der realen Daten testen.
2. `DATABASE_URL`, `AUTH_SECRET`, `APP_URL` und `AUTH_TRUST_HOST` passend zur Installation setzen.
   `ALLOW_REGISTRATION=false` für den internen Regelbetrieb, `AI_ENABLED=false` solange nicht gewünscht.
   `TZ=Europe/Berlin` auch im App-Prozess setzen.
3. Bestehenden Deploymentweg nutzen. Bei Node:
   `npm ci`, `npx prisma generate`, `npx prisma migrate deploy`, `npm run build`.
4. Für Echtzeitfunktionen den vorhandenen `server.ts` verwenden:
   Entwicklung `npm run dev:server`; Produktion `NODE_ENV=production npx tsx server.ts`
   (in PowerShell NODE_ENV vor dem Aufruf als Umgebungsvariable setzen).
   Der bestehende Docker-Aufbau startet diesen Server bereits.
5. Im bestehenden Docker-Setup nach Backup `docker compose up -d --build` ausführen
   und Erfolg des `migrate`-Dienstes sowie App-Healthcheck prüfen.
6. Aktivierte Administratoranmeldung prüfen, weitere Mitarbeitende über Einladungslinks freischalten.
   Bestehende nicht aktivierte Einladungen neu ausstellen.

Keine Migration wurde gegen eine reale Installation ausgeführt: lokal war weder eine
erreichbare Betriebsdatenbank noch Docker verfügbar. Vorhandene .env-Geheimnisse wurden nicht verändert.
Ein reiner `next dev`/`next start`-Prozess hat keinen Socket.IO-Server; die Oberfläche zeigt dann
fehlende Live-Verbindung. HTTP-Funktionen funktionieren trotzdem.

## 4. Testanleitung und Nachweise

### Automatisiert
```text
npx prisma generate
npx tsc --noEmit --incremental false
npx eslint src tests --quiet
npm run test:workflows
npm run build
```

`test:workflows` erzeugt eine vollständig getrennte, flüchtige PostgreSQL-Engine
(PGlite), spielt alle Migrationen ein, startet Next auf 127.0.0.1:3305 und führt echte
Anmeldungen und HTTP-Requests aus. Die Testdaten gehen nie in die konfigurierte Betriebsdatenbank.
Port 55439 wird für die Testdatenbank verwendet. Tests nicht parallel ausführen.
Ein anderer HTTP-Port ist über `TEST_PORT` möglich. `--serve` hält die Testumgebung
für eine manuelle Browserprüfung offen; sie endet beim Stoppen des Testprozesses.

Geprüft: zwei getrennte Organisationen; anonyme/Employee/Admin-Zugriffe; Aktivierung;
Entwurfsschutz; Veröffentlichung; Bestätigung und Rücknahme bei Änderung; Kopieren und Wiederholung;
Nacht-/Jahreswechsel; Kollisionen, Abwesenheiten, Qualifikationen, Verfügbarkeiten;
Tausch und offene Übernahme einschließlich Doppelgenehmigung; Stoppuhr/Pause;
Zeitkorrektur und Fremdzugriff; Stunden-/CSV-Auswertung; interne Nachricht und Lesestatus.

### Manuell als Administrator
1. Mitarbeitenden anlegen, Personendetails ergänzen, Einladung erzeugen.
2. Einsatzort mit Treffpunkt/Hinweisen und eine passende Tätigkeit anlegen.
3. In einer Woche eine Nachtschicht erstellen, wiederholen, kopieren und Person zuweisen.
4. Überlappende Schicht bzw. eine Person ohne Qualifikation zuweisen: verständliche Ablehnung erwarten.
5. Entwurf mit Mitarbeiterkonto vergleichen, veröffentlichen, Nachrichteneingang prüfen.
6. Zeit/Einsatzort ändern: neue Nachricht und erneute Bestätigung erforderlich.
7. Urlaubs-, Tausch-, Übernahme- und Korrekturanträge prüfen und genehmigen/ablehnen.
8. Auswertung samt Pausenabzug kontrollieren und CSV in Excel öffnen.

### Manuell als Mitarbeiter
1. Einladung aktivieren, anmelden. Keine Personal-/Einstellungsverwaltung in der Navigation.
2. Eigene nächste Schicht samt Treffpunkt sehen und bestätigen.
3. Offene passende Schicht anfragen und eine eigene Schicht zum Tausch anbieten.
4. Verfügbarkeit eintragen; Abwesenheit beantragen und Entscheidung im Postfach prüfen.
5. Stoppuhr starten, pausieren, Seite neu laden, fortsetzen und beenden.
6. Korrektur mit Begründung anfragen: Stunden ändern sich erst nach Freigabe.
7. Eigene Monatsstunden/CSV und Schichtnachrichten prüfen.
8. Dieselben Schritte auf Smartphone-Breite prüfen; Tabellen sind horizontal scrollbar.

Die Tests ersetzen keine Abnahme gegen echte Betriebsdaten, keinen produktiven
Mehrbenutzer-Lasttest und keine Prüfung tariflicher/arbeitsrechtlicher Anforderungen.

## 5. Kunden, Standorte und Freigaben (24.09.2026)

### Struktur
- Organisation → Kunde → Standort → Wochenplan je Standort und Kalenderwoche → Schicht.
  `Shift.branchId` entfällt; der Standort einer Schicht ist der Standort ihres Plans. Arbeitsbereiche bleiben unverändert.
- Neue Standorte brauchen einen Kunden. Standorte ohne Kunde (Altbestand) stehen unter „Ohne Kunde“;
  neue Schichten sind dort erst nach der Zuordnung möglich. Pläne ohne Standort sieht nur die Administration.
- Kein Kundenzugang: Kunden sind interne Planungsdaten.

### Rollen und Freigaben
- OWNER und ADMIN: organisationsweit. MANAGER: nur freigegebene Standorte und zugeordnete Personen.
  EMPLOYEE: eigene Daten; mit Standortfreigabe zusätzlich offene Schichten bzw. der veröffentlichte Standortplan.
- Ohne Freigabe kein Zugriff. Entzug und Deaktivierung wirken bei der nächsten Anfrage;
  offene Echtzeitverbindungen werden sofort angepasst bzw. getrennt.

| Standortrecht (`branch_access`) | Wirkung |
| --- | --- |
| Dienstplan ansehen | Vollständiger Standortplan mit Namen; Manager sehen auch Entwürfe |
| Schichten erstellen und bearbeiten | Anlegen, ändern, kopieren, besetzen |
| Dienstplan veröffentlichen | Wochenpläne freigeben oder zurückziehen |
| Anträge und Schichtübernahmen bearbeiten | Übernahmen und Tausch entscheiden |
| Zeiterfassung einsehen / bearbeiten | Zeiten des Standorts – für andere Personen nur zusammen mit „Stunden einsehen“ |
| Standortmeldungen bearbeiten | Interne Meldungen mit Status, zuständiger Person und Zeitstempel |
| Offene Schichten sehen und anfragen | Offene Plätze ohne Namen anderer; Übernahme anfragen |

| Personalrecht (`staff_assignments`, nur Manager) | Wirkung |
| --- | --- |
| In Schichten einplanen | Person steht beim Besetzen zur Auswahl |
| Personalprofil ansehen | Kontaktdaten, Tätigkeit, Qualifikationen |
| Stammdaten bearbeiten | Tätigkeit, Beschäftigungsart, Sollstunden, Qualifikationen, Notizen |
| Abwesenheiten einsehen und entscheiden | Anträge sehen, genehmigen, ablehnen |
| Stunden einsehen | Zeitbuchungen und Monatswerte an Standorten mit „Zeiterfassung einsehen“ |

Folgerechte werden automatisch gesetzt (Bearbeiten, Veröffentlichen und Anträge ⇒ Ansehen ⇒ Offene Schichten;
Zeiten bearbeiten ⇒ Zeiten einsehen; Stammdaten bearbeiten ⇒ Profil ansehen). Mitarbeitende können nur
„Dienstplan ansehen“ und „Offene Schichten“ erhalten. Voreinstellungen in der Oberfläche: Plan ansehen,
Planen, Standortverantwortung; für Mitarbeitende Offene Schichten, Standortplan ansehen; für Personal
Einplanen, Personalverantwortung.

### Startseite, Monatsplan und Zeiterfassung
- Startseite für Admins und Manager: Kundenkarten mit Standorten, offenen Plätzen der nächsten 28 Tage
  (auch in Entwürfen), Entwurfswochen und Standortmeldungen. Ein Klick öffnet den Monatsplan, „offene Plätze“
  die betroffenen Tage. Zähler erscheinen nur mit dem passenden Recht. Mitarbeitende behalten ihre Startseite.
- Monatsplan je Standort in Europe/Berlin, inklusive Nachtschichten über Monats- und Jahresgrenzen.
  Fehlende Besetzung = benötigte minus wirksam zugewiesene Plätze (inaktive oder abwesende Personen zählen nicht).
- Zeitbuchungen erhalten einen Standort, wenn sie sich (Berliner Zeit) mit genau einem Standort einer
  veröffentlichten, eigenen Schicht überschneiden; ohne Uhrzeit zählt das Datum. Unklare Buchungen sehen nur
  die Person und die Administration, die sie in der Zeiterfassung zuordnen kann.

### Durchsetzung
Zentral in `src/lib/access.ts` für Seiten, Schnittstellen, Suche, Zählwerte, CSV-Export, Nachrichtenempfänger
und Echtzeiträume. Zusammengesetzte Fremdschlüssel und der Trigger `akro_same_organization` verhindern
Verknüpfungen über Organisationsgrenzen.

### Migration `20260924090000_customers_branch_access`
- Teilt Wochenpläne mit Schichten mehrerer Standorte verlustfrei auf: Schichten samt Buchungen und Anträgen,
  Veröffentlichungsstatus und Darstellung, Briefings (kopiert), Live-Sitzungen (kopiert) und Live-Protokolle.
  Bei widersprüchlichen Altdaten bricht sie ohne Änderung ab.
- Legt keine Kunden und keine Freigaben an.
- Geprüft mit `npm run test:migration` (flüchtige Datenbank) und `npm run test:migration:copy`
  (Kopie echter Daten, Datenbankname mit copy, kopie oder migtest).
- Am 24.09.2026 in die lokale Produktivinstallation (Docker-Projekt `schichtplaner`) eingespielt – nach Backup
  `backups/schichtplaner-2026-09-24_1409.sql` und Probelauf auf einer Kopie davon (26/26 Prüfungen).
  Datenstand danach: eine Organisation, ein Konto (Inhaber), keine Kunden, keine Standorte, 11 leere Wochenpläne ohne Standort.

### Einrichtung durch die Administration
1. **Einsatzorte**: „Kunde anlegen“, danach „Einsatzort anlegen“; Altstandorte über „Kunden zuordnen“.
2. **Mitarbeiter** → Person → **Freigaben** → „Standort freigeben“, Umfang wählen, „Freigeben“.
3. Bei Managern „Mitarbeitende zuordnen“; einzelne Rechte über „Rechte ändern“.
4. „Entziehen“ bzw. „Zuordnung entfernen“ nimmt die Freigabe sofort zurück.

### Offene fachliche Punkte
- Welche Freigaben erhalten Manager und Mitarbeitende beim Anlegen?
- Dürfen Admins eigene Zeitkorrekturen genehmigen (derzeit ja; Manager nein)?
- Vorläufig festgelegt: KI, Zeitkategorien und Dateiverwaltung nur für Admins; Sollstunden anderer nur für Admins;
  Themen und Portal-Dateien organisationsweit; Admin-Namen für alle als Ansprechpartner sichtbar.

