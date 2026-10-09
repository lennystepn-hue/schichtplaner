"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Layers, Loader2, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DivisionCard } from "./division-card";
import { DivisionForm } from "./division-form";
import { useCurrentMember } from "@/lib/hooks/use-current-member";

type Division = {
  id: string;
  title: string;
  description: string | null;
  color: string;
  isSystem: boolean;
  memberCount: number;
  createdAt: string;
};

type Employee = {
  id: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
};

export function DivisionList() {
  const { data: currentMember } = useCurrentMember();
  const queryClient = useQueryClient();
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignDivisionId, setAssignDivisionId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");

  const isAdmin =
    currentMember?.role === "OWNER" || currentMember?.role === "ADMIN";

  // Fetch divisions
  const {
    data,
    isLoading,
    error,
  } = useQuery<{ divisions: Division[] }>({
    queryKey: ["divisions"],
    queryFn: async () => {
      const res = await fetch("/api/divisions");
      if (!res.ok) throw new Error("Fehler beim Laden der Arbeitsbereiche");
      return res.json();
    },
  });

  // Fetch employees (for assign dialog)
  const { data: employeesData } = useQuery<{ members: Employee[] }>({
    queryKey: ["employees", "all"],
    queryFn: async () => {
      const res = await fetch("/api/employees?status=all");
      if (!res.ok) throw new Error("Fehler beim Laden");
      return res.json();
    },
    enabled: assignDialogOpen,
  });

  // Assign employee mutation
  const assignMutation = useMutation({
    mutationFn: async ({
      divisionId,
      userId,
    }: {
      divisionId: string;
      userId: string;
    }) => {
      const res = await fetch(`/api/divisions/${divisionId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Zuweisen");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Mitarbeiter wurde zugewiesen");
      queryClient.invalidateQueries({ queryKey: ["divisions"] });
      queryClient.invalidateQueries({
        queryKey: ["division-members", assignDivisionId],
      });
      setAssignDialogOpen(false);
      setSelectedUserId("");
      setAssignDivisionId(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function openAssignDialog(divisionId: string) {
    setAssignDivisionId(divisionId);
    setSelectedUserId("");
    setAssignDialogOpen(true);
  }

  function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignDivisionId || !selectedUserId) return;
    assignMutation.mutate({
      divisionId: assignDivisionId,
      userId: selectedUserId,
    });
  }

  const assignDivision = data?.divisions?.find(
    (d) => d.id === assignDivisionId
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">Arbeitsbereiche</h1>
          <p className="text-sm text-muted-foreground">
            Organisiere dein Team in Arbeitsbereiche
          </p>
        </div>
        {isAdmin && <DivisionForm />}
      </div>

      {/* Error */}
      {error && (
        <Card className="p-6 text-center text-destructive">
          Fehler beim Laden der Arbeitsbereiche. Bitte versuche es erneut.
        </Card>
      )}

      {/* Loading */}
      {isLoading && <DivisionListSkeleton />}

      {/* Empty state */}
      {!isLoading && !error && data?.divisions?.length === 0 && (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <Layers className="size-12 text-muted-foreground/50 mb-3" />
          <p className="text-lg font-medium">
            Keine Arbeitsbereiche vorhanden
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Erstelle deinen ersten Arbeitsbereich.
          </p>
        </Card>
      )}

      {/* Division Grid */}
      {!isLoading && !error && data?.divisions && data.divisions.length > 0 && (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {data.divisions.map((division) => (
            <div key={division.id} className="relative">
              <DivisionCard division={division} isAdmin={isAdmin} />
              {/* Assign button for admin */}
              {isAdmin && (
                <div className="mt-1 flex justify-end px-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => openAssignDialog(division.id)}
                  >
                    <UserPlus className="size-3.5" />
                    Mitarbeiter zuweisen
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Assign Employee Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleAssign}>
            <DialogHeader>
              <DialogTitle>Mitarbeiter zuweisen</DialogTitle>
              <DialogDescription>
                Weise einen Mitarbeiter dem Arbeitsbereich{" "}
                &quot;{assignDivision?.title}&quot; zu.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4">
              <Select
                value={selectedUserId}
                onValueChange={setSelectedUserId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Mitarbeiter waehlen..." />
                </SelectTrigger>
                <SelectContent>
                  {employeesData?.members?.map((emp) => (
                    <SelectItem key={emp.user.id} value={emp.user.id}>
                      {emp.user.lastName}, {emp.user.firstName} (
                      {emp.user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAssignDialogOpen(false)}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={!selectedUserId || assignMutation.isPending}
              >
                {assignMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Zuweisen
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DivisionListSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <Skeleton className="h-1.5 w-full" />
          <div className="p-4 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-20" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
