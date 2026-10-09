import {
  BarChart3,
  Building2,
  CalendarCheck,
  CalendarDays,
  Clock,
  House,
  MessageSquare,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { CurrentMember } from "@/lib/hooks/use-current-member";
import { summaryCan } from "@/lib/access-shared";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Zaehlt ungelesene Nachrichten an diesem Punkt. */
  badge?: "unread";
};

export type NavGroup = { title: string; items: NavItem[] };

export function isPlanner(role?: string): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
}

export function isAdmin(role?: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Rolle in der Sprache der Anwendung. */
export function rollenName(role?: string): string {
  switch (role) {
    case "OWNER":
      return "Inhaber";
    case "ADMIN":
      return "Administration";
    case "MANAGER":
      return "Disposition";
    case "EMPLOYEE":
      return "Mitarbeiter";
    default:
      return "";
  }
}

/** Was die Navigation zeigen darf - abgeleitet aus Rolle und Freigaben. */
function faehigkeiten(me?: CurrentMember) {
  const access = me?.access;
  const admin = isAdmin(me?.role);
  const manager = me?.role === "MANAGER";
  return {
    admin,
    planning: admin || manager,
    plans: summaryCan(access, "VIEW_SCHEDULE"),
    staff: admin || Object.keys(access?.staff ?? {}).length > 0,
    locations: admin || Object.keys(access?.branches ?? {}).length > 0,
  };
}

/**
 * Navigation nach Rolle und Freigaben. Bereiche ohne Recht tauchen gar nicht
 * erst auf - die Berechtigungen selbst prueft ausschliesslich der Server.
 */
export function navGroups(me?: CurrentMember): NavGroup[] {
  const can = faehigkeiten(me);
  if (!can.planning) {
    return [
      {
        title: "Arbeit",
        items: [
          { key: "dashboard", href: "/dashboard", label: "Heute", icon: House },
          { key: "schedule", href: "/schedule/employee", label: "Mein Dienstplan", icon: CalendarDays },
          ...(can.plans ? [{ key: "plans", href: "/schedule/month", label: "Standortpläne", icon: Building2 }] : []),
          { key: "time", href: "/time", label: "Zeiterfassung", icon: Clock },
        ],
      },
      {
        title: "Meine Anliegen",
        items: [
          { key: "requests", href: "/employees/absences", label: "Anträge", icon: CalendarCheck },
          { key: "portal", href: "/portal/inbox", label: "Nachrichten", icon: MessageSquare, badge: "unread" },
        ],
      },
    ];
  }

  return [
    {
      title: "Arbeit",
      items: [
        { key: "dashboard", href: "/dashboard", label: "Heute", icon: House },
        ...(can.plans ? [{ key: "schedule", href: "/schedule/month", label: "Dienstplan", icon: CalendarDays }] : []),
      ],
    },
    {
      title: "Personal",
      items: [
        ...(can.staff ? [{ key: "employees", href: "/employees", label: "Mitarbeiter", icon: Users }] : []),
        { key: "absences", href: "/employees/absences", label: "Abwesenheiten", icon: CalendarCheck },
        { key: "time", href: "/time", label: "Zeiterfassung", icon: Clock },
      ],
    },
    {
      title: "Organisation",
      items: [
        ...(can.locations ? [{ key: "divisions", href: "/divisions", label: "Einsatzorte", icon: Building2 }] : []),
        { key: "reporting", href: "/reporting", label: "Auswertung", icon: BarChart3 },
        { key: "portal", href: "/portal/inbox", label: "Nachrichten", icon: MessageSquare, badge: "unread" as const },
      ],
    },
  ];
}

/** Fuss der Seitenleiste: Einstellungen nur fuer die Administration. */
export function navFooterItems(me?: CurrentMember): NavItem[] {
  return isAdmin(me?.role)
    ? [{ key: "settings", href: "/settings", label: "Einstellungen", icon: Settings }]
    : [];
}

/** Untere Navigation auf dem Handy: hoechstens vier Ziele plus "Mehr". */
export function mobileNavItems(me?: CurrentMember): NavItem[] {
  const can = faehigkeiten(me);
  return [
    { key: "dashboard", href: "/dashboard", label: "Heute", icon: House },
    {
      key: "schedule",
      href: can.planning && can.plans ? "/schedule/month" : "/schedule/employee",
      label: "Plan",
      icon: CalendarDays,
    },
    { key: "time", href: "/time", label: "Zeit", icon: Clock },
    { key: "requests", href: "/employees/absences", label: "Anträge", icon: CalendarCheck },
  ];
}

/**
 * Titel fuer Unterseiten, die keinen eigenen Navigationspunkt haben.
 * Laengere Pfade stehen vor kuerzeren, damit der erste Treffer passt.
 */
const weitereTitel: [string, string][] = [
  ["/employees/absences", "Abwesenheiten"],
  ["/schedule", "Dienstplan"],
  ["/portal", "Nachrichten"],
  ["/profile", "Mein Profil"],
  ["/settings", "Einstellungen"],
];

/** Name der aktuellen Seite fuer die Kopfschiene. */
export function seitenTitel(pathname: string, me?: CurrentMember): string {
  for (const group of navGroups(me)) {
    for (const item of group.items) {
      if (isNavActive(item.href, pathname)) return item.label;
    }
  }
  for (const item of navFooterItems(me)) {
    if (isNavActive(item.href, pathname)) return item.label;
  }
  const treffer = weitereTitel.find(([pfad]) => pathname.startsWith(pfad));
  return treffer ? treffer[1] : "Übersicht";
}

/** Ist dieser Navigationspunkt zur aktuellen Adresse aktiv? */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/employees/absences") return pathname.startsWith(href);
  if (href === "/employees") {
    return pathname.startsWith("/employees") && !pathname.startsWith("/employees/absences");
  }
  if (href === "/schedule/month") return pathname.startsWith("/schedule/month");
  if (href === "/schedule/employee") return pathname.startsWith("/schedule") && !pathname.startsWith("/schedule/month");
  const segment = "/" + href.split("/")[1];
  return pathname === segment || pathname.startsWith(segment + "/");
}
