"use client";

import { useState } from "react";
import { CalendarDays, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AbsenceList } from "@/components/employees/absence-list";
import { AbsenceCalendar } from "@/components/employees/absence-calendar";
import { Availability } from "@/components/workforce/availability";

type ViewMode = "list" | "calendar";

export default function AbsencesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex justify-end">
        <div className="flex gap-1 rounded-md border p-0.5">
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="xs"
            onClick={() => setViewMode("list")}
          >
            <List className="size-3.5" />
            <span className="hidden sm:inline">Liste</span>
          </Button>
          <Button
            variant={viewMode === "calendar" ? "default" : "ghost"}
            size="xs"
            onClick={() => setViewMode("calendar")}
          >
            <CalendarDays className="size-3.5" />
            <span className="hidden sm:inline">Kalender</span>
          </Button>
        </div>
      </div>

      {viewMode === "list" ? <AbsenceList /> : <AbsenceCalendar />}
      <Availability />
    </div>
  );
}
