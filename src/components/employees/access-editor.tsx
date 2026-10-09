"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorMessage, json, selectClass, useAction } from "@/components/workforce/client";
import {
  BRANCH_PRESETS,
  BRANCH_RIGHTS,
  STAFF_PRESETS,
  STAFF_RIGHTS,
  normalizeBranchRights,
  normalizeStaffRights,
  type BranchRightKey,
  type StaffRightKey,
} from "@/lib/access-shared";

type AccessData = {
  member: { id: string; role: string; name: string };
  allowedBranchRights: BranchRightKey[];
  allowedStaffRights: StaffRightKey[];
  grants: { branchId: string; rights: BranchRightKey[]; updatedAt: string }[];
  branches: { id: string; name: string; isActive: boolean; customer: { id: string; name: string } | null }[];
  staff: { memberId: string; role: string; isActive: boolean; name: string; rights: StaffRightKey[]; updatedAt: string }[];
  candidates: { memberId: string; role: string; name: string }[];
  managers: { memberId: string; name: string; rights: StaffRightKey[] }[];
};

type RightOption<K extends string> = { key: K; label: string; hint: string };
type Preset<K extends string> = { label: string; rights: K[] };

function geändert(date: string) {
  return "geändert " + new Date(date).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Freigaben einer Person: Standorte mit einzelnen Rechten und - bei Managern -
 * zugeordnete Mitarbeitende. Nur fuer Admins; der Server prueft jede Aenderung
 * und wendet sie sofort auf Anfragen und Echtzeitverbindungen an.
 */
export function AccessEditor({ memberId }: { memberId: string }) {
  const query = useQuery({ queryKey: ["access", memberId], queryFn: () => json<AccessData>(`/api/employees/${memberId}/access`) });
  const action = useAction();
  const data = query.data;
  if (!data) return query.error ? <ErrorMessage error={query.error} /> : null;

  const role = data.member.role;
  const manager = role === "MANAGER";
  const branchOptions = BRANCH_RIGHTS.filter((r) => data.allowedBranchRights.includes(r.key));
  const staffOptions = STAFF_RIGHTS.filter((r) => data.allowedStaffRights.includes(r.key));
  const branchPresets = manager ? BRANCH_PRESETS.MANAGER : BRANCH_PRESETS.EMPLOYEE;
  const normalizeBranch = (rights: BranchRightKey[]) => normalizeBranchRights(rights, role);
  const normalizeStaff = (rights: StaffRightKey[]) => normalizeStaffRights(rights, role);
  const branch = (id: string) => data.branches.find((b) => b.id === id);
  const put = (payload: unknown, message: string) => action.mutateAsync({ url: `/api/employees/${memberId}/access`, method: "PUT", data: payload, message }).then(() => true, () => false);

  const granted = new Set(data.grants.map((g) => g.branchId));
  const assigned = new Set(data.staff.map((s) => s.memberId));
  const freieStandorte = data.branches.filter((b) => !granted.has(b.id));
  const kunden = [...new Map(freieStandorte.map((b) => [b.customer?.id ?? "", b.customer?.name ?? "Ohne Kunde"])).entries()];

  return (
    <Card className="space-y-6 p-5" id="freigaben">
      <div>
        <h2 className="text-[16px] font-semibold tracking-[-0.02em]">Freigaben</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {manager
            ? "Manager sehen und bearbeiten nur die hier freigegebenen Standorte und Mitarbeitenden – jeweils im Umfang der gewählten Rechte."
            : "Ohne Freigabe sieht die Person nur ihre eigenen Schichten, Zeiten und Abwesenheiten. Eine Standortfreigabe zeigt zusätzlich offene Schichten oder den Standortplan – ohne Stammdaten, Stunden oder Abwesenheiten anderer."}{" "}
          Änderungen wirken sofort, auch in bereits geöffneten Sitzungen.
        </p>
      </div>

      <section className="space-y-1" aria-labelledby="freigaben-standorte">
        <h3 id="freigaben-standorte" className="akro-label">Standorte</h3>
        {!data.grants.length && <p className="py-2 text-sm text-muted-foreground">Noch kein Standort freigegeben.</p>}
        {data.grants.map((g) => {
          const b = branch(g.branchId);
          return (
            <RechteZeile
              key={g.branchId + ":" + g.rights.join()}
              icon={<Building2 className="size-4 shrink-0 text-muted-foreground" />}
              titel={b ? b.name + (b.isActive ? "" : " (inaktiv)") : "Standort"}
              untertitel={[b?.customer?.name ?? "Ohne Kunde", geändert(g.updatedAt)].join(" · ")}
              rights={g.rights}
              options={branchOptions}
              presets={branchPresets}
              normalize={normalizeBranch}
              pending={action.isPending}
              entziehenText={`Die Freigabe für ${b?.name ?? "diesen Standort"} wird entfernt. ${data.member.name} verliert sofort den Zugriff auf Plan, Anträge, Zeiten und Meldungen dieses Standorts.`}
              onSave={(rights) => put({ kind: "branch", branchId: g.branchId, rights }, "Freigabe geändert")}
              onRevoke={() => put({ kind: "branch", branchId: g.branchId, rights: [] }, "Freigabe entzogen")}
            />
          );
        })}
        {freieStandorte.length > 0 && (
          <Hinzufuegen
            label="Standort freigeben"
            presets={branchPresets}
            pending={action.isPending}
            onAdd={(branchId, rights) => put({ kind: "branch", branchId, rights }, "Standort freigegeben")}
          >
            {kunden.map(([id, name]) => (
              <optgroup key={id || "ohne"} label={name}>
                {freieStandorte.filter((b) => (b.customer?.id ?? "") === id).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.isActive ? "" : " (inaktiv)"}</option>
                ))}
              </optgroup>
            ))}
          </Hinzufuegen>
        )}
      </section>

      {manager && (
        <section className="space-y-1" aria-labelledby="freigaben-personal">
          <h3 id="freigaben-personal" className="akro-label">Zugeordnete Mitarbeitende</h3>
          <p className="pb-1 text-sm text-muted-foreground">
            Profile, Kontaktdaten, Abwesenheiten und Stunden sieht ein Manager nur bei zugeordneten Personen und nur mit dem jeweiligen Recht.
            Namen im freigegebenen Standortplan bleiben davon unberührt.
          </p>
          {!data.staff.length && <p className="py-2 text-sm text-muted-foreground">Noch keine Mitarbeitenden zugeordnet.</p>}
          {data.staff.map((s) => (
            <RechteZeile
              key={s.memberId + ":" + s.rights.join()}
              icon={<UserRound className="size-4 shrink-0 text-muted-foreground" />}
              titel={s.name + (s.isActive ? "" : " (inaktiv)")}
              titelHref={`/employees/${s.memberId}`}
              untertitel={geändert(s.updatedAt)}
              rights={s.rights}
              options={staffOptions}
              presets={STAFF_PRESETS}
              normalize={normalizeStaff}
              pending={action.isPending}
              entziehenLabel="Zuordnung entfernen"
              entziehenText={`${s.name} wird ${data.member.name} nicht mehr zugeordnet. Profil, Abwesenheiten und Stunden sind für ${data.member.name} sofort nicht mehr sichtbar.`}
              onSave={(rights) => put({ kind: "staff", memberId: s.memberId, rights }, "Zuordnung geändert")}
              onRevoke={() => put({ kind: "staff", memberId: s.memberId, rights: [] }, "Zuordnung entfernt")}
            />
          ))}
          {data.candidates.some((c) => !assigned.has(c.memberId)) && (
            <Hinzufuegen
              label="Mitarbeitende zuordnen"
              presets={STAFF_PRESETS}
              pending={action.isPending}
              onAdd={(id, rights) => put({ kind: "staff", memberId: id, rights }, "Mitarbeitende zugeordnet")}
            >
              {data.candidates.filter((c) => !assigned.has(c.memberId)).map((c) => (
                <option key={c.memberId} value={c.memberId}>{c.name}{c.role === "MANAGER" ? " (Manager)" : ""}</option>
              ))}
            </Hinzufuegen>
          )}
        </section>
      )}

      {data.managers.length > 0 && (
        <section className="space-y-1" aria-labelledby="freigaben-zustaendig">
          <h3 id="freigaben-zustaendig" className="akro-label">Zuständige Manager</h3>
          <ul className="divide-y divide-[var(--linie-fein)]">
            {data.managers.map((m) => (
              <li key={m.memberId} className="py-2 text-sm">
                <Link href={`/employees/${m.memberId}#freigaben`} className="font-medium text-primary underline-offset-4 hover:underline">{m.name}</Link>
                <span className="text-muted-foreground"> · {m.rights.map((r) => STAFF_RIGHTS.find((x) => x.key === r)?.label ?? r).join(", ")}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Zuordnungen änderst du im Profil des jeweiligen Managers.</p>
        </section>
      )}
    </Card>
  );
}

/** Eine bestehende Freigabe: zusammengefasst, auf Wunsch mit einzelnen Rechten. */
function RechteZeile<K extends string>({
  icon, titel, titelHref, untertitel, rights, options, presets, normalize, pending, onSave, onRevoke, entziehenLabel = "Entziehen", entziehenText,
}: {
  icon: React.ReactNode;
  titel: string;
  titelHref?: string;
  untertitel: string;
  rights: K[];
  options: RightOption<K>[];
  presets: Preset<K>[];
  normalize: (rights: K[]) => K[];
  pending: boolean;
  onSave: (rights: K[]) => Promise<boolean>;
  onRevoke: () => Promise<boolean>;
  entziehenLabel?: string;
  entziehenText: string;
}) {
  const [offen, setOffen] = useState(false);
  const [entwurf, setEntwurf] = useState<K[]>(rights);
  const geaendert = entwurf.join() !== rights.join();
  const label = (key: K) => options.find((o) => o.key === key)?.label ?? key;

  return (
    <div className="space-y-2 border-t py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {icon}
          <div className="min-w-0">
            {titelHref ? (
              <Link href={titelHref} className="text-sm font-medium underline-offset-4 hover:underline">{titel}</Link>
            ) : (
              <p className="text-sm font-medium">{titel}</p>
            )}
            <p className="tabular text-xs text-muted-foreground">{untertitel}</p>
            {!offen && <p className="mt-1 text-sm">{rights.map(label).join(" · ")}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" aria-expanded={offen} onClick={() => { setEntwurf(rights); setOffen(!offen); }}>
            {offen ? "Schließen" : "Rechte ändern"}
          </Button>
          <ConfirmDialog title={entziehenLabel + "?"} description={entziehenText} confirmLabel={entziehenLabel} disabled={pending} onConfirm={() => { void onRevoke(); }}>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending}>{entziehenLabel}</Button>
          </ConfirmDialog>
        </div>
      </div>

      {offen && (
        <div className="space-y-3 rounded-[var(--radius)] border bg-[var(--flaeche-kopf)] p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Voreinstellung:</span>
            {presets.map((p) => (
              <Button key={p.label} type="button" size="xs" variant="outline" aria-pressed={normalize(p.rights).join() === entwurf.join()} onClick={() => setEntwurf(normalize(p.rights))}>
                {p.label}
              </Button>
            ))}
          </div>
          <RechteAuswahl options={options} value={entwurf} normalize={normalize} onChange={setEntwurf} disabled={pending} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!geaendert || !entwurf.length || pending} onClick={() => { void onSave(entwurf).then((ok) => { if (ok) setOffen(false); }); }}>
              Änderung speichern
            </Button>
            {geaendert && <Button size="sm" variant="ghost" onClick={() => setEntwurf(rights)}>Verwerfen</Button>}
            {!entwurf.length && <p className="self-center text-xs text-muted-foreground">Ohne Rechte bitte „{entziehenLabel}“ verwenden.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Einzelrechte als Kontrollkaestchen. Rechte, die sich aus einem anderen ergeben, sind gesetzt und gesperrt. */
function RechteAuswahl<K extends string>({ options, value, normalize, onChange, disabled }: { options: RightOption<K>[]; value: K[]; normalize: (rights: K[]) => K[]; onChange: (rights: K[]) => void; disabled?: boolean }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">Einzelrechte</legend>
      {options.map((o) => {
        const checked = value.includes(o.key);
        const folgt = checked && normalize(value.filter((r) => r !== o.key)).includes(o.key);
        return (
          <label key={o.key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
              checked={checked}
              disabled={disabled || folgt}
              onChange={(e) => onChange(normalize(e.target.checked ? [...value, o.key] : value.filter((r) => r !== o.key)))}
            />
            <span>
              {o.label}
              {folgt && <span className="text-muted-foreground"> · ergibt sich aus einem anderen Recht</span>}
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Neue Freigabe: Ziel waehlen, Umfang per Voreinstellung - Feinheiten danach ueber "Rechte ändern". */
function Hinzufuegen<K extends string>({ label, presets, pending, onAdd, children }: { label: string; presets: Preset<K>[]; pending: boolean; onAdd: (id: string, rights: K[]) => Promise<boolean>; children: React.ReactNode }) {
  const [ziel, setZiel] = useState("");
  const [umfang, setUmfang] = useState(0);
  return (
    <div className="flex flex-wrap items-end gap-2 border-t pt-3">
      <label className="min-w-[14rem] flex-1 text-sm">
        {label}
        <select className={selectClass} value={ziel} onChange={(e) => setZiel(e.target.value)}>
          <option value="">Bitte wählen</option>
          {children}
        </select>
      </label>
      <label className="min-w-[12rem] text-sm">
        Umfang
        <select className={selectClass} value={umfang} onChange={(e) => setUmfang(Number(e.target.value))}>
          {presets.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
        </select>
      </label>
      <Button disabled={!ziel || pending} onClick={() => { void onAdd(ziel, presets[umfang].rights).then((ok) => { if (ok) setZiel(""); }); }}>
        Freigeben
      </Button>
    </div>
  );
}
