"use client";

import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { LogOut, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCurrentMember } from "@/lib/hooks/use-current-member";
import { rollenName } from "./nav-config";

export function UserMenu({
  collapsed = false,
  dunkel = false,
}: {
  collapsed?: boolean;
  /** Darstellung auf der dunklen Navigationsschiene. */
  dunkel?: boolean;
}) {
  const { data: member } = useCurrentMember();
  const { theme, setTheme } = useTheme();

  const firstName = member?.user.firstName ?? "";
  const lastName = member?.user.lastName ?? "";
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  const fullName = `${firstName} ${lastName}`.trim();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-11 w-full",
            collapsed ? "justify-center px-0" : "justify-start gap-2.5 px-2",
            dunkel &&
              "text-[color:var(--schiene-text)] hover:bg-[var(--schiene-flaeche)] hover:text-[color:var(--schiene-text)]"
          )}
          aria-label="Benutzerkonto"
        >
          <Avatar size="sm">
            {member?.user.profileImage && (
              <AvatarImage
                src={member.user.profileImage}
                alt={fullName}
              />
            )}
            <AvatarFallback
              className={
                dunkel
                  ? "bg-[var(--schiene-aktiv)] text-[color:var(--schiene-text)]"
                  : "bg-secondary text-secondary-foreground"
              }
            >
              {initials || "?"}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <span className="min-w-0 text-left">
              <span className="block truncate text-[13px] leading-tight font-medium">
                {fullName || "Laden ..."}
              </span>
              {member?.role && (
                <span
                  className={cn(
                    "block truncate text-[11px] leading-tight font-normal",
                    dunkel
                      ? "text-[color:var(--schiene-gedimmt)]"
                      : "text-muted-foreground"
                  )}
                >
                  {rollenName(member.role)}
                </span>
              )}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">{fullName}</p>
            {member?.organizationName && (
              <p className="text-xs text-muted-foreground">
                {member.organizationName}
              </p>
            )}
            {member?.user.email && (
              <p className="text-xs text-muted-foreground truncate">
                {member.user.email}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <Sun className="mr-2 size-4" />
          ) : (
            <Moon className="mr-2 size-4" />
          )}
          {theme === "dark" ? "Hellmodus" : "Dunkelmodus"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: "/login" })}
          variant="destructive"
        >
          <LogOut className="mr-2 size-4" />
          Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
