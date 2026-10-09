"use client";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ScheduleSettingsProps {
  nameFormat: string;
  onUpdate: (data: Record<string, unknown>) => void;
  isSaving: boolean;
}

export function ScheduleSettings({
  nameFormat,
  onUpdate,
  isSaving,
}: ScheduleSettingsProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Schichtplan</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Einstellungen fuer den Schichtplan
        </p>
      </div>

      <Card className="p-6 space-y-6">
        {/* Name format */}
        <div className="space-y-2">
          <Label>Namensformat</Label>
          <p className="text-xs text-muted-foreground">
            Wie sollen Mitarbeiternamen im Schichtplan angezeigt werden?
          </p>
          <Select
            value={nameFormat}
            onValueChange={(value) => onUpdate({ nameFormat: value })}
            disabled={isSaving}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LASTNAME_FIRSTNAME">
                Nachname, Vorname
              </SelectItem>
              <SelectItem value="FIRSTNAME_LASTNAME">
                Vorname Nachname
              </SelectItem>
              <SelectItem value="LASTNAME">Nur Nachname</SelectItem>
              <SelectItem value="FIRSTNAME">Nur Vorname</SelectItem>
              <SelectItem value="NICKNAME">Spitzname</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Die fruehere Einstellung "Sichtbarkeit" ist durch Freigaben je Standort ersetzt. */}
        <div className="space-y-2">
          <Label>Sichtbarkeit</Label>
          <p className="text-sm text-muted-foreground">
            Mitarbeitende sehen ihre eigenen Schichten. Standortpläne und offene
            Schichten sehen sie nur mit einer Freigabe für den jeweiligen
            Standort. Freigaben vergibst du im Profil der Person unter
            „Freigaben“.
          </p>
        </div>
      </Card>
    </div>
  );
}
