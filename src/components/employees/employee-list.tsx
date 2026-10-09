"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  ShieldCheck,
  UserCog,
  AlertTriangle,
  UserX,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmployeeForm } from "./employee-form";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { STAFF_RIGHTS } from "@/lib/access-shared";

type Employee = {
  id: string;
  role: string;
  isActive: boolean;
  isActivated: boolean;
  joinedAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    // Kontaktdaten nur mit "Personalprofil ansehen" (sonst null).
    email: string | null;
    phone: string | null;
    nickname: string | null;
    profileImage: string | null;
  };
  /** Personalrechte der angemeldeten Person fuer diese Person; null fuer Admins. */
  rights: string[] | null;
};

type EmployeeResponse = {
  members: Employee[];
  counts: {
    all: number;
    admin: number;
    manager: number;
    not_activated: number;
    inactive: number;
  };
};

type FilterTab = "all" | "admin" | "manager" | "not_activated" | "inactive";

const tabs: {
  key: FilterTab;
  label: string;
  icon: React.ElementType;
}[] = [
  { key: "all", label: "Alle", icon: Users },
  { key: "admin", label: "Admins", icon: ShieldCheck },
  { key: "manager", label: "Manager", icon: UserCog },
  { key: "not_activated", label: "Nicht freigeschaltet", icon: AlertTriangle },
  { key: "inactive", label: "Inaktiv", icon: UserX },
];

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function getRoleBadge(role: string) {
  switch (role) {
    case "OWNER":
      return (
        <Badge className="bg-warn/10 text-warn dark:bg-warn/20 dark:text-warn">
          Owner
        </Badge>
      );
    case "ADMIN":
      return (
        <Badge className="bg-accent text-primary">
          Admin
        </Badge>
      );
    case "MANAGER":
      return (
        <Badge className="bg-ok/10 text-ok dark:bg-ok/20 dark:text-ok">
          Manager
        </Badge>
      );
    default:
      return <Badge variant="secondary">Mitarbeiter</Badge>;
  }
}

export function EmployeeList() {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const router = useRouter();
  const { data: currentMember } = useCurrentMember();

  const isAdmin = !!currentMember?.access.isAdmin;
  // Das Profil oeffnet sich nur, wo der Server es auch ausliefert.
  const profil = (emp: Employee) => emp.rights === null || emp.rights.includes("VIEW_PROFILE");
  const rechte = (emp: Employee) => (emp.rights ?? []).map((r) => STAFF_RIGHTS.find((x) => x.key === r)?.label ?? r).join(" · ");

  const queryParams = new URLSearchParams();
  if (search) queryParams.set("search", search);

  // Map tab to API params
  if (activeTab === "admin") queryParams.set("role", "ADMIN");
  if (activeTab === "manager") queryParams.set("role", "MANAGER");
  if (activeTab === "not_activated") queryParams.set("status", "not_activated");
  if (activeTab === "inactive") queryParams.set("status", "inactive");
  if (activeTab === "all") queryParams.set("status", "all");

  const { data, isLoading, error } = useQuery<EmployeeResponse>({
    queryKey: ["employees", activeTab, search],
    queryFn: async () => {
      const res = await fetch(`/api/employees?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Mitarbeiter");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">Mitarbeiter</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "Verwalte dein Team und weise Rollen zu" : "Dir zugeordnete Mitarbeitende und deine Rechte"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/employees/absences")}
          >
            <CalendarDays className="size-4" />
            <span className="hidden sm:inline">Abwesenheiten</span>
          </Button>
          {isAdmin && <EmployeeForm />}
        </div>
      </div>

      {/* Search + Filter Tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAdmin ? "Suche nach Name oder E-Mail..." : "Suche nach Name..."}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {tabs.filter((tab) => isAdmin || tab.key !== "admin").map((tab) => {
            const Icon = tab.icon;
            const count = data?.counts?.[tab.key] ?? 0;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-primary dark:text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="tabular-nums text-xs opacity-70">
                  ({count})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <Card className="p-6 text-center text-destructive">
          Fehler beim Laden der Mitarbeiter. Bitte versuche es erneut.
        </Card>
      )}

      {/* Loading */}
      {isLoading && <EmployeeListSkeleton />}

      {/* Empty state */}
      {!isLoading && !error && data?.members?.length === 0 && (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <Users className="size-12 text-muted-foreground/50 mb-3" />
          <p className="text-lg font-medium">Keine Mitarbeiter gefunden</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search
              ? "Versuche eine andere Suche."
              : isAdmin
                ? "Lege deinen ersten Mitarbeiter an."
                : "Dir sind noch keine Mitarbeitenden zugeordnet. Zuordnungen vergibt die Administration."}
          </p>
        </Card>
      )}

      {/* Desktop Table */}
      {!isLoading && !error && data?.members && data.members.length > 0 && (
        <>
          <Card className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>E-Mail</TableHead>
                  {!isAdmin && <TableHead>Deine Rechte</TableHead>}
                  <TableHead>Rolle</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.members.map((emp) => (
                  <TableRow
                    key={emp.id}
                    className={cn(profil(emp) && "cursor-pointer")}
                    onClick={profil(emp) ? () => router.push(`/employees/${emp.id}`) : undefined}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar size="default">
                          {emp.user.profileImage && (
                            <AvatarImage src={emp.user.profileImage} />
                          )}
                          <AvatarFallback>
                            {getInitials(
                              emp.user.firstName,
                              emp.user.lastName
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">
                            {emp.user.lastName}, {emp.user.firstName}
                          </div>
                          {emp.user.nickname && (
                            <div className="text-xs text-muted-foreground">
                              &quot;{emp.user.nickname}&quot;
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {emp.user.email ?? "–"}
                    </TableCell>
                    {!isAdmin && (
                      <TableCell className="text-sm text-muted-foreground">
                        {rechte(emp)}
                      </TableCell>
                    )}
                    <TableCell>{getRoleBadge(emp.role)}</TableCell>
                    <TableCell>
                      {!emp.isActive ? (
                        <Badge variant="destructive">Inaktiv</Badge>
                      ) : !emp.isActivated ? (
                        <Badge
                          variant="outline"
                          className="border-warn/40 text-warn"
                        >
                          <AlertTriangle className="size-3" />
                          Nicht freigeschaltet
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-ok/40 text-ok"
                        >
                          Aktiv
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile Cards */}
          <div className="space-y-2 md:hidden">
            {data.members.map((emp) => (
              <Card
                key={emp.id}
                className={cn("p-4", profil(emp) && "cursor-pointer transition-colors hover:bg-muted/50")}
                onClick={profil(emp) ? () => router.push(`/employees/${emp.id}`) : undefined}
              >
                <div className="flex items-center gap-3">
                  <Avatar size="default">
                    {emp.user.profileImage && (
                      <AvatarImage src={emp.user.profileImage} />
                    )}
                    <AvatarFallback>
                      {getInitials(emp.user.firstName, emp.user.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {emp.user.lastName}, {emp.user.firstName}
                      </span>
                      {getRoleBadge(emp.role)}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {isAdmin ? emp.user.email : rechte(emp)}
                    </div>
                  </div>
                  <div>
                    {!emp.isActive ? (
                      <Badge variant="destructive">Inaktiv</Badge>
                    ) : !emp.isActivated ? (
                      <AlertTriangle className="size-4 text-warn" />
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EmployeeListSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="p-4 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}
