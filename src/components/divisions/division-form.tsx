"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  { name: "Indigo", hex: "#6366f1" },
  { name: "Rot", hex: "#ef4444" },
  { name: "Gruen", hex: "#22c55e" },
  { name: "Blau", hex: "#3b82f6" },
  { name: "Gelb", hex: "#eab308" },
  { name: "Lila", hex: "#a855f7" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Orange", hex: "#f97316" },
];

type DivisionData = {
  id: string;
  title: string;
  description: string | null;
  color: string;
};

type DivisionFormProps = {
  division?: DivisionData;
  trigger?: React.ReactNode;
};

export function DivisionForm({ division, trigger }: DivisionFormProps) {
  const isEdit = !!division;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0].hex);
  const queryClient = useQueryClient();

  function changeOpen(next: boolean) {
    if (next && division) {
      setTitle(division.title);
      setDescription(division.description ?? "");
      setColor(division.color);
    } else if (next && !division) {
      setTitle("");
      setDescription("");
      setColor(PRESET_COLORS[0].hex);
    }
    setOpen(next);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const url = isEdit
        ? `/api/divisions/${division.id}`
        : "/api/divisions";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          color,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Speichern");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(
        isEdit
          ? "Arbeitsbereich wurde aktualisiert"
          : "Arbeitsbereich wurde erstellt"
      );
      queryClient.invalidateQueries({ queryKey: ["divisions"] });
      setOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Titel ist erforderlich");
      return;
    }
    if (title.length > 100) {
      toast.error("Titel darf maximal 100 Zeichen haben");
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            Neuen Arbeitsbereich erstellen
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit
                ? "Arbeitsbereich bearbeiten"
                : "Neuen Arbeitsbereich erstellen"}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Bearbeite die Details des Arbeitsbereichs."
                : "Erstelle einen neuen Arbeitsbereich fuer dein Team."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="division-title">Titel *</Label>
              <Input
                id="division-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z.B. Kundenservice, Technik..."
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground text-right">
                {title.length}/100
              </p>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="division-description">Beschreibung</Label>
              <Textarea
                id="division-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optionale Beschreibung..."
                rows={3}
              />
            </div>

            {/* Color Picker */}
            <div className="space-y-1.5">
              <Label>Farbe</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    title={preset.name}
                    onClick={() => setColor(preset.hex)}
                    className={cn(
                      "size-8 rounded-full transition-all",
                      color === preset.hex
                        ? "ring-2 ring-offset-2 ring-offset-background scale-110"
                        : "hover:scale-105"
                    )}
                    style={
                      {
                        backgroundColor: preset.hex,
                        "--tw-ring-color": preset.hex,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {isEdit ? "Speichern" : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Small edit button variant for use in cards
export function DivisionEditButton({ division }: { division: DivisionData }) {
  return (
    <DivisionForm
      division={division}
      trigger={
        <Button variant="ghost" size="icon" className="size-7">
          <Pencil className="size-3.5" />
        </Button>
      }
    />
  );
}
