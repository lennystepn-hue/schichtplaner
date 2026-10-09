"use client";

import {
  Calendar,
  Clock,
  FileHeart,
  Users,
  Umbrella,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const sections = [
  {
    key: "schedule",
    label: "Schichtplan",
    icon: Calendar,
  },
  {
    key: "time",
    label: "Zeiterfassung",
    icon: Clock,
  },
  {
    key: "wishplan",
    label: "Wunschplaene",
    icon: FileHeart,
  },
  {
    key: "employees",
    label: "Mitarbeiter",
    icon: Users,
  },
  {
    key: "absences",
    label: "Abwesenheiten",
    icon: Umbrella,
  },
  {
    key: "account",
    label: "Account",
    icon: Building2,
  },
] as const;

export type SettingsSection = (typeof sections)[number]["key"];

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

export function SettingsSidebar({
  activeSection,
  onSectionChange,
}: SettingsSidebarProps) {
  return (
    <aside className="w-56 shrink-0">
      <nav>
        <h3 className="mb-2 px-3 text-xs font-semibold text-muted-foreground">
          Einstellungen
        </h3>
        <ul className="space-y-0.5">
          {sections.map((section) => {
            const Icon = section.icon;
            const active = activeSection === section.key;
            return (
              <li key={section.key}>
                <button
                  type="button"
                  onClick={() => onSectionChange(section.key)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  <span>{section.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
