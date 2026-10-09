"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Mail,
  Phone,
  Pencil,
  Check,
  X,
  Trash2,
  Loader2,
  StickyNote,
  Send,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Personnel } from "@/components/workforce/personnel";
import { AccessEditor } from "./access-editor";

type EmployeeDetail = {
  id: string;
  role: string;
  isActive: boolean;
  isActivated: boolean;
  joinedAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    nickname: string | null;
    profileImage: string | null;
    createdAt: string;
  };
  /** Was die angemeldete Person hier darf - vom Server berechnet. */
  permissions: {
    editContact: boolean;
    editPersonnel: boolean;
    notes: boolean;
    admin: boolean;
    manageAccess: boolean;
  };
};

type Note = {
  id: string;
  subjectId: string;
  authorId: string;
  text: string;
  createdAt: string;
  author: {
    id: string;
    firstName: string;
    lastName: string;
  };
};

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function getRoleLabel(role: string) {
  switch (role) {
    case "OWNER":
      return "Owner";
    case "ADMIN":
      return "Admin";
    case "MANAGER":
      return "Manager";
    default:
      return "Mitarbeiter";
  }
}

function getRoleBadgeColor(role: string) {
  switch (role) {
    case "OWNER":
      return "bg-warn/10 text-warn dark:bg-warn/20 dark:text-warn";
    case "ADMIN":
      return "bg-accent text-primary";
    case "MANAGER":
      return "bg-ok/10 text-ok dark:bg-ok/20 dark:text-ok";
    default:
      return "";
  }
}

// Inline editable field component
function InlineEdit({
  value,
  onSave,
  type = "text",
  disabled = false,
}: {
  value: string;
  onSave: (val: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function handleSave() {
    if (draft.trim() !== value) {
      onSave(draft.trim());
    }
    setEditing(false);
  }

  function handleCancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          autoFocus
          className="h-7 text-sm"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleSave}
          className="text-ok"
        >
          <Check className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCancel}
          className="text-muted-foreground"
        >
          <X className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1">
      <span className="text-sm">{value || "-"}</span>
      {!disabled && (
        <button
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className="invisible group-hover:visible text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
      )}
    </div>
  );
}

export function EmployeeDetail({ memberId }: { memberId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");

  // Fetch employee detail
  const {
    data: employee,
    isLoading,
    error,
  } = useQuery<EmployeeDetail>({
    queryKey: ["employee", memberId],
    queryFn: async () => {
      const res = await fetch(`/api/employees/${memberId}`);
      if (!res.ok) throw new Error("Mitarbeiter nicht gefunden");
      return res.json();
    },
  });

  // Fetch notes
  const { data: notes } = useQuery<Note[]>({
    queryKey: ["employee-notes", memberId],
    queryFn: async () => {
      const res = await fetch(`/api/employees/${memberId}/notes`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!employee?.permissions.notes,
  });

  // Update employee mutation
  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await fetch(`/api/employees/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Fehler beim Speichern");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Gespeichert");
      queryClient.invalidateQueries({ queryKey: ["employee", memberId] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Change role mutation
  const roleMutation = useMutation({
    mutationFn: async (role: string) => {
      const res = await fetch(`/api/employees/${memberId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Fehler beim Aendern der Rolle");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Rolle geaendert");
      queryClient.invalidateQueries({ queryKey: ["employee", memberId] });
      queryClient.invalidateQueries({ queryKey: ["access", memberId] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/employees/${memberId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Fehler beim Deaktivieren");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Mitarbeiter deaktiviert");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      router.push("/employees");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Create note mutation
  const noteMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(`/api/employees/${memberId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Fehler beim Speichern der Notiz");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Notiz gespeichert");
      setNoteText("");
      queryClient.invalidateQueries({
        queryKey: ["employee-notes", memberId],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  if (isLoading) {
    return <EmployeeDetailSkeleton />;
  }

  if (error || !employee) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push("/employees")}>
          <ArrowLeft className="size-4" />
          Zurueck
        </Button>
        <Card className="p-12 text-center">
          <p className="text-destructive">Mitarbeiter nicht gefunden.</p>
        </Card>
      </div>
    );
  }

  const canEdit = employee.permissions.editContact;
  const canChangeRole = employee.permissions.admin;
  const canDelete = employee.permissions.admin;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" onClick={() => router.push("/employees")}>
        <ArrowLeft className="size-4" />
        Zurueck zur Liste
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar size="lg">
            {employee.user.profileImage && (
              <AvatarImage src={employee.user.profileImage} />
            )}
            <AvatarFallback className="text-lg">
              {getInitials(employee.user.firstName, employee.user.lastName)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">
              {employee.user.lastName}, {employee.user.firstName}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={getRoleBadgeColor(employee.role)}>
                {getRoleLabel(employee.role)}
              </Badge>
              {!employee.isActive && (
                <Badge variant="destructive">Inaktiv</Badge>
              )}
              {employee.isActive && !employee.isActivated && (
                <Badge
                  variant="outline"
                  className="border-warn/40 text-warn"
                >
                  Nicht freigeschaltet
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Actions dropdown */}
        {(canChangeRole || canDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Aktionen</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canDelete && employee.isActive && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="size-4" />
                  Deaktivieren
                </DropdownMenuItem>
              )}
              {canDelete && !employee.isActive && (
                <DropdownMenuItem
                  onClick={() => {
                    // Reactivate by updating isActive through a custom approach
                    // For now we use the PATCH endpoint concept
                    toast.info("Reaktivierung noch nicht implementiert");
                  }}
                >
                  Reaktivieren
                </DropdownMenuItem>
              )}
              {canChangeRole && (
                <>
                  <DropdownMenuSeparator />
                  {["ADMIN", "MANAGER", "EMPLOYEE"]
                    .filter((r) => r !== employee.role)
                    .map((r) => (
                      <DropdownMenuItem
                        key={r}
                        onClick={() => roleMutation.mutate(r)}
                      >
                        Rolle zu {getRoleLabel(r)} aendern
                      </DropdownMenuItem>
                    ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Content Grid */}
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Left column - Contact info + Notes */}
        <div className="space-y-6">
          {/* Contact Info */}
          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">
              Kontaktdaten
            </h2>

            <div className="space-y-3">
              {/* Name */}
              <div className="grid grid-cols-[120px_1fr] items-center">
                <span className="text-sm text-muted-foreground">Vorname</span>
                <InlineEdit
                  value={employee.user.firstName}
                  onSave={(v) => updateMutation.mutate({ firstName: v })}
                  disabled={!canEdit}
                />
              </div>
              <div className="grid grid-cols-[120px_1fr] items-center">
                <span className="text-sm text-muted-foreground">Nachname</span>
                <InlineEdit
                  value={employee.user.lastName}
                  onSave={(v) => updateMutation.mutate({ lastName: v })}
                  disabled={!canEdit}
                />
              </div>
              <div className="grid grid-cols-[120px_1fr] items-center">
                <span className="text-sm text-muted-foreground">Spitzname</span>
                <InlineEdit
                  value={employee.user.nickname || ""}
                  onSave={(v) => updateMutation.mutate({ nickname: v })}
                  disabled={!canEdit}
                />
              </div>

              {/* Email */}
              <div className="grid grid-cols-[120px_1fr] items-center">
                <span className="text-sm text-muted-foreground">
                  <Mail className="inline size-3.5 mr-1" />
                  E-Mail
                </span>
                <InlineEdit
                  value={employee.user.email}
                  onSave={(v) => updateMutation.mutate({ email: v })}
                  type="email"
                  disabled={!canEdit}
                />
              </div>

              {/* Phone */}
              <div className="grid grid-cols-[120px_1fr] items-center">
                <span className="text-sm text-muted-foreground">
                  <Phone className="inline size-3.5 mr-1" />
                  Telefon
                </span>
                <InlineEdit
                  value={employee.user.phone || ""}
                  onSave={(v) => updateMutation.mutate({ phone: v })}
                  type="tel"
                  disabled={!canEdit}
                />
              </div>
            </div>

            {/* Role change (inline) */}
            {canChangeRole && (
              <div className="grid grid-cols-[120px_1fr] items-center pt-2 border-t">
                <span className="text-sm text-muted-foreground">Rolle</span>
                <Select
                  value={employee.role}
                  onValueChange={(v) => roleMutation.mutate(v)}
                  disabled={roleMutation.isPending}
                >
                  <SelectTrigger className="w-[160px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="EMPLOYEE">Mitarbeiter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </Card>

          {/* Quick Navigation */}
          <Card className="p-5 space-y-3">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">
              Navigation
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled>
                <Clock className="size-4" />
                Stunden
              </Button>
            </div>
          </Card>

          {/* Notes Section */}
          {employee.permissions.notes && (
            <Card className="p-5 space-y-4">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">
                <StickyNote className="inline size-3.5 mr-1" />
                Notizen
              </h2>

              {/* Add note form */}
              <div className="flex gap-2">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Notiz hinzufuegen..."
                  className="min-h-[60px]"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    if (noteText.trim()) {
                      noteMutation.mutate(noteText.trim());
                    }
                  }}
                  disabled={!noteText.trim() || noteMutation.isPending}
                >
                  {noteMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>

              {/* Notes list */}
              {notes && notes.length > 0 ? (
                <div className="space-y-3">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-md border p-3 text-sm"
                    >
                      <p className="whitespace-pre-wrap">{note.text}</p>
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {note.author.firstName} {note.author.lastName}
                        </span>
                        <span>-</span>
                        <span>
                          {new Date(note.createdAt).toLocaleDateString("de-DE", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Noch keine Notizen vorhanden.
                </p>
              )}
            </Card>
          )}
        </div>

        {/* Right column - E-Dash placeholder */}
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide mb-4">
              Monatsuebersicht
            </h2>
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Clock className="size-10 opacity-30 mb-3" />
              <p className="text-sm font-medium">E-Dash</p>
              <p className="text-xs mt-1">
                Stundenauswertung wird mit dem Zeiterfassungsmodul verfuegbar.
              </p>
            </div>
          </Card>

          {/* Member Meta */}
          <Card className="p-5 space-y-3">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">
              Mitgliedschaft
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Beigetreten</span>
                <span>
                  {new Date(employee.joinedAt).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span>
                  {employee.isActive ? "Aktiv" : "Inaktiv"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Freigeschaltet</span>
                <span>{employee.isActivated ? "Ja" : "Nein"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Member-ID</span>
                <span className="tabular text-xs text-muted-foreground">
                  {employee.id}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Personnel id={employee.id} />
      {employee.permissions.manageAccess && <AccessEditor memberId={employee.id} />}
      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mitarbeiter deaktivieren?</DialogTitle>
            <DialogDescription>
              {employee.user.firstName} {employee.user.lastName} wird
              deaktiviert und hat keinen Zugriff mehr auf die Organisation. Diese
              Aktion kann rueckgaengig gemacht werden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteMutation.mutate();
                setDeleteOpen(false);
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Deaktivieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-32" />
      <div className="flex items-center gap-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
