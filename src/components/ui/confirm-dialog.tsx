"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  /** Der Ausloeser, zum Beispiel ein Löschen-Knopf. Entfaellt im
      gesteuerten Betrieb, wenn `open` gesetzt ist. */
  children?: React.ReactNode;
  /** Gesteuerter Betrieb: Dialog von aussen öffnen und schliessen. */
  open?: boolean;
  onOpenChange?: (value: boolean) => void;
  title: string;
  /** Was genau passiert und was sich nicht rueckgaengig machen laesst. */
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** Rot einfaerben, wenn Daten verloren gehen. */
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * Einheitliche Rückfrage vor gefährlichen Aktionen - statt window.confirm,
 * das sich nicht gestalten laesst und auf dem Handy leicht weggetippt wird.
 */
export function ConfirmDialog({
  children,
  open: openProp,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = true,
  disabled,
}: ConfirmDialogProps) {
  const [eigenerZustand, setEigenerZustand] = useState(false);
  const gesteuert = openProp !== undefined;
  const open = gesteuert ? openProp : eigenerZustand;

  function setOpen(value: boolean) {
    if (gesteuert) onOpenChange?.(value);
    else setEigenerZustand(value);
  }

  return (
    <>
      {children && (
        <span
          onClick={() => {
            if (!disabled) setOpen(true);
          }}
          className="contents"
        >
          {children}
        </span>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
