"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Star } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type OrgEmployee = {
  id: string;
  role: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    nickname: string | null;
    profileImage: string | null;
  };
};

type ScoreBreakdown = {
  hours: number;
  availability: number;
  division: number;
  history: number;
};

type EmployeeScoreData = {
  employeeId: string;
  firstName: string;
  lastName: string;
  score: number;
  breakdown: ScoreBreakdown;
};

interface EmployeePickerProps {
  /** IDs of users already booked in this shift */
  bookedUserIds: string[];
  /** Called when an employee is selected */
  onSelect: (userId: string) => void;
  /** Optional shift ID for AI recommendation scoring */
  shiftId?: string;
  children: React.ReactNode;
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Inhaber",
  ADMIN: "Admin",
  MANAGER: "Manager",
  EMPLOYEE: "MA",
};

const ROLE_COLORS: Record<string, string> = {
  OWNER: "bg-warn/10 text-warn dark:bg-warn/20 dark:text-warn",
  ADMIN: "bg-accent text-accent-foreground",
  MANAGER: "bg-accent text-accent-foreground",
  EMPLOYEE: "bg-muted text-muted-foreground",
};

/** Get the CSS classes for a score badge based on value. */
function getScoreColor(score: number): string {
  if (score >= 80) return "bg-ok/10 text-ok dark:bg-ok/20 dark:text-ok";
  if (score >= 50) return "bg-warn/10 text-warn dark:bg-warn/20 dark:text-warn";
  return "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive";
}

/** Format score breakdown for tooltip display. */
function formatBreakdown(breakdown: ScoreBreakdown): string {
  const lines: string[] = [];
  lines.push(`Stunden: ${breakdown.hours}/40`);
  lines.push(`Verfuegbarkeit: ${breakdown.availability}/30`);
  lines.push(`Bereich: ${breakdown.division}/20`);
  lines.push(`Historie: ${breakdown.history}/10`);
  return lines.join("\n");
}

export function EmployeePicker({
  bookedUserIds,
  onSelect,
  shiftId,
  children,
}: EmployeePickerProps) {
  const [open, setOpen] = useState(false);

  // Fetch all active org employees
  const { data } = useQuery<{ members: OrgEmployee[] }>({
    queryKey: ["employees", "active", shiftId],
    queryFn: async () => {
      const res = await fetch(shiftId ? "/api/shifts/" + shiftId + "/candidates" : "/api/employees?status=active");
      if (!res.ok) throw new Error("Fehler beim Laden der Mitarbeiter");
      return res.json();
    },
    enabled: open,
  });

  // Fetch AI recommendation scores (lazy: only when picker opens and shiftId is provided)
  const { data: scoresData, isLoading: scoresLoading } = useQuery<{
    scores: EmployeeScoreData[];
  }>({
    queryKey: ["ai-recommend", shiftId],
    queryFn: async () => {
      const res = await fetch(`/api/ai/recommend?shiftId=${shiftId}`);
      if (!res.ok) return { scores: [] };
      return res.json();
    },
    enabled: open && !!shiftId,
  });

  const employees = data?.members ?? [];
  const scores = scoresData?.scores ?? [];
  const bookedSet = new Set(bookedUserIds);

  // Build a map of userId -> score data for quick lookup
  const scoreMap = new Map<string, EmployeeScoreData>();
  for (const s of scores) {
    scoreMap.set(s.employeeId, s);
  }

  // Sort employees by score if scores are available
  const sortedEmployees = [...employees].sort((a, b) => {
    const scoreA = scoreMap.get(a.user.id)?.score ?? -1;
    const scoreB = scoreMap.get(b.user.id)?.score ?? -1;
    // Booked users always go last
    const bookedA = bookedSet.has(a.user.id) ? 1 : 0;
    const bookedB = bookedSet.has(b.user.id) ? 1 : 0;
    if (bookedA !== bookedB) return bookedA - bookedB;
    // Sort by score descending
    return scoreB - scoreA;
  });

  function handleSelect(userId: string) {
    if (bookedSet.has(userId)) return;
    onSelect(userId);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" sideOffset={4}>
        <Command>
          <CommandInput placeholder="Mitarbeiter suchen..." />
          <CommandList>
            <CommandEmpty>Keine Mitarbeiter gefunden</CommandEmpty>
            <CommandGroup>
              {shiftId && scoresLoading && (
                <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Bewertungen laden...
                </div>
              )}
              {sortedEmployees.map((emp) => {
                const isBooked = bookedSet.has(emp.user.id);
                const scoreData = scoreMap.get(emp.user.id);

                return (
                  <CommandItem
                    key={emp.id}
                    value={`${emp.user.firstName} ${emp.user.lastName} ${emp.user.nickname ?? ""}`}
                    onSelect={() => handleSelect(emp.user.id)}
                    disabled={isBooked}
                    className={cn(isBooked && "opacity-50")}
                  >
                    <Avatar size="sm">
                      <AvatarFallback className="text-[9px]">
                        {getInitials(emp.user.firstName, emp.user.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 truncate text-sm">
                      {emp.user.firstName} {emp.user.lastName}
                    </span>
                    {isBooked ? (
                      <Check className="size-3.5 text-ok" />
                    ) : scoreData ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-[9px] px-1.5 py-0 gap-0.5 cursor-help",
                                getScoreColor(scoreData.score)
                              )}
                            >
                              <Star className="size-2.5" />
                              {scoreData.score}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent
                            side="left"
                            className="whitespace-pre text-[11px] leading-relaxed"
                          >
                            {formatBreakdown(scoreData.breakdown)}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[9px] px-1.5 py-0",
                          ROLE_COLORS[emp.role]
                        )}
                      >
                        {ROLE_LABELS[emp.role] ?? emp.role}
                      </Badge>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
