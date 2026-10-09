import { Toaster } from "sonner";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MainContainer } from "@/components/layout/main-container";
import { MobileNav } from "@/components/layout/mobile-nav";
import { TopNav } from "@/components/layout/top-nav";
import { QueryProvider } from "@/components/providers/query-provider";
import { SocketProvider } from "@/components/providers/socket-provider";
import { getCurrentMember } from "@/lib/auth-helpers";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await getCurrentMember())) redirect("/login");
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <QueryProvider>
          <SocketProvider>
            <a
              href="#inhalt"
              className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-foreground"
            >
              Zum Inhalt springen
            </a>
            <div className="flex min-h-screen bg-background">
              <AppSidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <TopNav />
                <MainContainer>{children}</MainContainer>
              </div>
            </div>
            <MobileNav />
            <Toaster
              position="top-right"
              // Meldungen tragen die Flaechen und Linien der Oberflaeche.
              style={
                {
                  "--normal-bg": "var(--card)",
                  "--normal-text": "var(--foreground)",
                  "--normal-border": "var(--border)",
                  "--border-radius": "var(--radius-panel)",
                } as React.CSSProperties
              }
            />
          </SocketProvider>
        </QueryProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
