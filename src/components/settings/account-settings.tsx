"use client";

import { toast } from "sonner";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

interface AccountSettingsProps {
  orgName: string;
  orgAddress: string;
  onUpdate: (data: Record<string, unknown>) => void;
  isSaving: boolean;
}

export function AccountSettings({
  orgName,
  orgAddress,
  onUpdate,
  isSaving,
}: AccountSettingsProps) {
  const [name, setName] = useState(orgName);
  const [address, setAddress] = useState(orgAddress);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");

  const hasChanges = name !== orgName || address !== orgAddress;

  function handleSave() {
    const updates: Record<string, unknown> = {};
    if (name !== orgName) updates.name = name;
    if (address !== orgAddress) updates.address = address;
    if (Object.keys(updates).length > 0) {
      onUpdate(updates);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Account</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Firmendaten und Account-Verwaltung
        </p>
      </div>

      {/* Company info */}
      <Card className="p-6 space-y-4">
        <Label className="text-base font-semibold">Firmendaten</Label>

        <div className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label>Firmenname</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Firmenname eingeben"
              disabled={isSaving}
            />
          </div>

          <div className="space-y-2">
            <Label>Adresse</Label>
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Firmenadresse eingeben"
              rows={3}
              disabled={isSaving}
            />
          </div>

          {hasChanges && (
            <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              Speichern
            </Button>
          )}
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-destructive" />
          <Label className="text-base font-semibold text-destructive">
            Gefahrenzone
          </Label>
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Das Loeschen des Accounts entfernt alle Daten unwiderruflich. Dieser
            Vorgang kann nicht rueckgaengig gemacht werden.
          </p>

          {!showDeleteConfirm ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Account loeschen anfragen
            </Button>
          ) : (
            <div className="space-y-3 max-w-md p-4 rounded-lg border border-destructive/30 bg-destructive/5">
              <p className="text-sm font-medium">
                Gib &quot;LOESCHEN&quot; ein um fortzufahren:
              </p>
              <Input
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder='Tippe "LOESCHEN"'
                className="border-destructive/30"
              />
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteInput !== "LOESCHEN"}
                  onClick={() => {
                    // Noch nicht umgesetzt: ehrlich melden statt Erfolg
                    // vorzutaeuschen.
                    toast.info(
                      "Loeschung ist noch nicht eingerichtet. Bitte wende dich an die Administration."
                    );
                    setShowDeleteConfirm(false);
                    setDeleteInput("");
                  }}
                >
                  Unwiderruflich loeschen
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteInput("");
                  }}
                >
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
