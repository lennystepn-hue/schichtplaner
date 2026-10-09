"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import {
  SettingsSidebar,
  type SettingsSection,
} from "@/components/settings/settings-sidebar";
import { ScheduleSettings } from "@/components/settings/schedule-settings";
import { TimeSettings } from "@/components/settings/time-settings";
import { AbsenceSettings } from "@/components/settings/absence-settings";
import { AccountSettings } from "@/components/settings/account-settings";

// ---------- Types ----------

type SettingsResponse = {
  organization: {
    id: string;
    name: string;
    address: string | null;
    nameFormat: string;
  };
  timeSettings: {
    whoCanUse: string;
    watchAutoStop: boolean;
    warningsEnabled: boolean;
    warningsMaxHours: number;
    useCategories: boolean;
  };
  absenceCategories: {
    id: string;
    name: string;
    color: string;
    isPaid: boolean;
  }[];
  holidays: {
    id: string;
    name: string;
    date: string;
    country: string;
    state: string | null;
  }[];
  orgSettings: {
    aiEnabled: boolean;
    smsEnabled: boolean;
  };
};

// ---------- Component ----------

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: currentMember, isLoading: memberLoading } = useCurrentMember();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("schedule");

  const isAdmin =
    currentMember?.role === "OWNER" || currentMember?.role === "ADMIN";

  // Fetch settings
  const { data, isLoading, error } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Fehler beim Laden der Einstellungen");
      return res.json();
    },
    enabled: isAdmin,
  });

  // Update settings mutation
  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Fehler beim Speichern");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Einstellungen gespeichert");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function handleUpdate(data: Record<string, unknown>) {
    updateMutation.mutate(data);
  }

  // Loading states
  if (memberLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Access denied
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <ShieldAlert className="size-12 text-muted-foreground/50" />
        <h2 className="text-xl font-semibold">Zugriff verweigert</h2>
        <p className="text-sm text-muted-foreground">
          Nur Administratoren und Inhaber koennen die Einstellungen bearbeiten.
        </p>
      </div>
    );
  }

  // Loading settings
  if (isLoading) {
    return (
      <div className="flex gap-6">
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        <div className="flex-1 flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Error
  if (error || !data) {
    return (
      <div className="flex gap-6">
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        <div className="flex-1">
          <Card className="p-6 text-center text-destructive">
            Fehler beim Laden der Einstellungen. Bitte versuche es erneut.
          </Card>
        </div>
      </div>
    );
  }

  // Determine holiday country/state from first holiday or default
  const holidayCountry =
    data.holidays.length > 0 ? data.holidays[0].country : "DE";
  const holidayState =
    data.holidays.length > 0 ? data.holidays[0].state ?? "" : "";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">Einstellungen</h1>
        <p className="text-sm text-muted-foreground">
          Organisation und Systemeinstellungen verwalten
        </p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar - hidden on mobile, shown on md+ */}
        <div className="hidden md:block">
          <SettingsSidebar
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />
        </div>

        {/* Mobile section selector */}
        <div className="md:hidden w-full">
          <select
            value={activeSection}
            onChange={(e) =>
              setActiveSection(e.target.value as SettingsSection)
            }
            className="w-full rounded-md border bg-background px-3 py-2 text-sm mb-4"
          >
            <option value="schedule">Schichtplan</option>
            <option value="time">Zeiterfassung</option>
            <option value="wishplan">Wunschplaene</option>
            <option value="employees">Mitarbeiter</option>
            <option value="absences">Abwesenheiten</option>
            <option value="account">Account</option>
          </select>
        </div>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          {activeSection === "schedule" && (
            <ScheduleSettings
              nameFormat={data.organization.nameFormat}
              onUpdate={handleUpdate}
              isSaving={updateMutation.isPending}
            />
          )}

          {activeSection === "time" && (
            <TimeSettings
              timeSettings={data.timeSettings}
              onUpdate={handleUpdate}
              isSaving={updateMutation.isPending}
            />
          )}

          {activeSection === "wishplan" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold">Wunschplaene</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Einstellungen fuer Wunschplaene
                </p>
              </div>
              <Card className="flex flex-col items-center justify-center p-12 text-center">
                <p className="text-lg font-medium">Bald verfuegbar</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Die Einstellungen fuer Wunschplaene werden in einem zukuenftigen
                  Update hinzugefuegt.
                </p>
              </Card>
            </div>
          )}

          {activeSection === "employees" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold">Mitarbeiter</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Mitarbeiter-Einstellungen
                </p>
              </div>
              <Card className="flex flex-col items-center justify-center p-12 text-center">
                <p className="text-lg font-medium">Bald verfuegbar</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Weitere Mitarbeiter-Einstellungen werden in einem zukuenftigen
                  Update hinzugefuegt.
                </p>
              </Card>
            </div>
          )}

          {activeSection === "absences" && (
            <AbsenceSettings
              categories={data.absenceCategories}
              holidayCountry={holidayCountry}
              holidayState={holidayState}
              onUpdateSettings={handleUpdate}
              isSaving={updateMutation.isPending}
            />
          )}

          {activeSection === "account" && (
            <AccountSettings
              orgName={data.organization.name}
              orgAddress={data.organization.address ?? ""}
              onUpdate={handleUpdate}
              isSaving={updateMutation.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}
