"use client";

import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Users,
  BarChart3,
  Loader2,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ForecastChart } from "@/components/ai/forecast-chart";

// ─── Types ──────────────────────────────────────────────────────────

interface WeeklyDataPoint {
  weekNumber: number;
  year: number;
  label: string;
  actualHours: number;
  employeeCount: number;
  shiftCount: number;
  isForecast: boolean;
  movingAvg?: number;
  forecastHours?: number;
}

interface ForecastData {
  dataPoints: WeeklyDataPoint[];
  trend: "up" | "down" | "stable";
  trendPercent: number;
  avgHoursPerWeek: number;
  totalEmployees: number;
  summary?: string;
}

// ─── Page ───────────────────────────────────────────────────────────

export default function AiInsightsPage() {
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<{ forecast: ForecastData }>({
    queryKey: ["ai-forecast"],
    queryFn: async () => {
      const res = await fetch("/api/ai/forecast?summary=true");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Fehler beim Laden der Prognose");
      }
      return res.json();
    },
  });

  const forecast = data?.forecast;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-accent">
            <BarChart3 className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-[22px] leading-none font-[560] tracking-[-0.03em]">KI-Insights & Prognose</h1>
            <p className="text-sm text-muted-foreground">
              Stunden-Trends und Prognosen basierend auf historischen Daten
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/ai/chat">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Sparkles className="size-3.5" />
              KI-Chat
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw
              className={cn("size-3.5", isFetching && "animate-spin")}
            />
            Aktualisieren
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-3">
            <Loader2 className="mx-auto size-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Prognose wird berechnet...
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 dark:bg-destructive/20 dark:border-destructive/40 p-6 text-center">
          <p className="text-sm text-destructive dark:text-destructive">
            {error instanceof Error ? error.message : "Fehler beim Laden"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => refetch()}
          >
            Erneut versuchen
          </Button>
        </div>
      )}

      {/* Data display */}
      {forecast && !isLoading && (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Average hours */}
            <MetricCard
              icon={Clock}
              label="Ø Stunden / Woche"
              value={`${forecast.avgHoursPerWeek}h`}
              description="Letzte 12 Wochen"
            />

            {/* Trend */}
            <MetricCard
              icon={
                forecast.trend === "up"
                  ? TrendingUp
                  : forecast.trend === "down"
                    ? TrendingDown
                    : Minus
              }
              label="Trend"
              value={`${forecast.trendPercent > 0 ? "+" : ""}${forecast.trendPercent}%`}
              description={
                forecast.trend === "up"
                  ? "Steigende Tendenz"
                  : forecast.trend === "down"
                    ? "Sinkende Tendenz"
                    : "Stabil"
              }
              variant={
                forecast.trend === "up"
                  ? "success"
                  : forecast.trend === "down"
                    ? "danger"
                    : "neutral"
              }
            />

            {/* Employees */}
            <MetricCard
              icon={Users}
              label="Aktive Mitarbeiter"
              value={String(forecast.totalEmployees)}
              description="In der Organisation"
            />
          </div>

          {/* Forecast chart */}
          <div className="akro-panel p-6">
            <h2 className="text-lg font-semibold mb-4">
              Stunden-Verlauf & Prognose
            </h2>
            <ForecastChart
              dataPoints={forecast.dataPoints}
              summary={forecast.summary}
            />
          </div>

          {/* Weekly breakdown table */}
          <div className="akro-panel overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Wochen-Details</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium">Woche</th>
                    <th className="text-right px-4 py-2 font-medium">
                      Stunden
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      Schichten
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      Mitarbeiter
                    </th>
                    <th className="text-right px-4 py-2 font-medium">
                      Ø h/MA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.dataPoints.map((dp, idx) => {
                    const hours = dp.isForecast
                      ? dp.forecastHours ?? 0
                      : dp.actualHours;
                    const avgPerEmployee =
                      dp.employeeCount > 0
                        ? (dp.actualHours / dp.employeeCount).toFixed(1)
                        : "-";

                    return (
                      <tr
                        key={idx}
                        className={cn(
                          "border-b last:border-0",
                          dp.isForecast && "bg-warn/10/50 dark:bg-warn/20"
                        )}
                      >
                        <td className="px-4 py-2">
                          <span className="font-medium">{dp.label}</span>
                          {dp.isForecast && (
                            <span className="ml-1.5 text-[10px] text-warn dark:text-warn font-medium">
                              PROGNOSE
                            </span>
                          )}
                        </td>
                        <td className="text-right px-4 py-2 tabular">
                          {hours.toFixed(1)}h
                        </td>
                        <td className="text-right px-4 py-2 tabular">
                          {dp.isForecast ? "-" : dp.shiftCount}
                        </td>
                        <td className="text-right px-4 py-2 tabular">
                          {dp.isForecast ? "-" : dp.employeeCount}
                        </td>
                        <td className="text-right px-4 py-2 tabular">
                          {dp.isForecast ? "-" : avgPerEmployee}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Metric Card ────────────────────────────────────────────────────

function MetricCard({
  icon: Icon,
  label,
  value,
  description,
  variant = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  description: string;
  variant?: "success" | "danger" | "neutral";
}) {
  return (
    <div className="akro-panel p-4">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            variant === "success" && "bg-ok/10 dark:bg-ok/20",
            variant === "danger" && "bg-destructive/10 dark:bg-destructive/20",
            variant === "neutral" && "bg-muted"
          )}
        >
          <Icon
            className={cn(
              "size-4",
              variant === "success" && "text-ok dark:text-ok",
              variant === "danger" && "text-destructive dark:text-destructive",
              variant === "neutral" && "text-muted-foreground"
            )}
          />
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
    </div>
  );
}
