"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  Users,
  X,
  Loader2,
  Lock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { DivisionEditButton } from "./division-form";
import { cn } from "@/lib/utils";

type Division = {
  id: string;
  title: string;
  description: string | null;
  color: string;
  isSystem: boolean;
  memberCount: number;
};

type DivisionMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  profileImage: string | null;
  role: string;
};

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

type DivisionCardProps = {
  division: Division;
  isAdmin: boolean;
};

export function DivisionCard({ division, isAdmin }: DivisionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  // Fetch members when expanded
  const {
    data: membersData,
    isLoading: membersLoading,
  } = useQuery<{ members: DivisionMember[] }>({
    queryKey: ["division-members", division.id],
    queryFn: async () => {
      const res = await fetch(`/api/divisions/${division.id}/members`);
      if (!res.ok) throw new Error("Fehler beim Laden");
      return res.json();
    },
    enabled: expanded,
  });

  // Delete division mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/divisions/${division.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Löschen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Arbeitsbereich wurde gelöscht");
      queryClient.invalidateQueries({ queryKey: ["divisions"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Unassign member mutation
  const unassignMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/divisions/${division.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Entfernen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Mitarbeiter wurde entfernt");
      queryClient.invalidateQueries({
        queryKey: ["division-members", division.id],
      });
      queryClient.invalidateQueries({ queryKey: ["divisions"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const [loeschOffen, setLoeschOffen] = useState(false);

  function handleDelete() {
    setLoeschOffen(true);
  }

  return (
    <>
    <Card className="overflow-hidden">
      {/* Color accent - top bar */}
      <div className="h-1.5" style={{ backgroundColor: division.color }} />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate">{division.title}</h3>
              {division.isSystem && (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 text-xs"
                >
                  <Lock className="size-3" />
                  System
                </Badge>
              )}
            </div>
            {division.description && (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                {division.description}
              </p>
            )}
          </div>

          {/* Action buttons - only for non-system divisions, admin+ only */}
          {isAdmin && !division.isSystem && (
            <div className="flex items-center gap-0.5 shrink-0">
              <DivisionEditButton division={division} />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Member count + expand button */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="size-4" />
            <span>
              {division.memberCount}{" "}
              {division.memberCount === 1 ? "Mitarbeiter" : "Mitarbeiter"}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                Einklappen
                <ChevronUp className="size-3.5" />
              </>
            ) : (
              <>
                Anzeigen
                <ChevronDown className="size-3.5" />
              </>
            )}
          </Button>
        </div>

        {/* Expanded: member list */}
        {expanded && (
          <div className="mt-3 border-t pt-3">
            {membersLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            )}

            {!membersLoading &&
              membersData?.members &&
              membersData.members.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Keine Mitarbeiter zugewiesen
                </p>
              )}

            {!membersLoading &&
              membersData?.members &&
              membersData.members.length > 0 && (
                <ul className="space-y-1.5">
                  {membersData.members.map((m) => (
                    <li
                      key={m.id}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5",
                        "hover:bg-muted/50 transition-colors"
                      )}
                    >
                      <Avatar size="sm">
                        {m.profileImage && (
                          <AvatarImage src={m.profileImage} />
                        )}
                        <AvatarFallback>
                          {getInitials(m.firstName, m.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm flex-1 truncate">
                        {m.lastName}, {m.firstName}
                      </span>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => unassignMutation.mutate(m.id)}
                          disabled={unassignMutation.isPending}
                        >
                          <X className="size-3" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}
      </div>
    </Card>
      <ConfirmDialog
        open={loeschOffen}
        onOpenChange={setLoeschOffen}
        title="Arbeitsbereich löschen"
        description={`"${division.title}" wird gelöscht. Schichten behalten ihre Daten, verlieren aber die Zuordnung zu diesem Bereich.`}
        confirmLabel="Löschen"
        onConfirm={() => deleteMutation.mutate()}
      />
    </>
  );
}
