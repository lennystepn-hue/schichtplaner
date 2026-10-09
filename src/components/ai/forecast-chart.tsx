"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

// ─── Types ──────────────────────────────────────────────────────────

interface DataPoint {
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

interface ForecastChartProps {
  dataPoints: DataPoint[];
  summary?: string;
}

// ─── Custom Tooltip ─────────────────────────────────────────────────

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  // Access the raw data point from the first entry
  const rawData = (payload[0] as unknown as { payload: DataPoint })?.payload;
  const isForecast = rawData?.isForecast;

  return (
    <div className="akro-panel p-3 text-sm">
      <p className="font-semibold mb-1">
        {label} {isForecast && "(Prognose)"}
      </p>
      {payload.map((entry, idx) => {
        if (entry.value === 0 && entry.dataKey === "actualHours" && isForecast)
          return null;
        if (
          entry.value === undefined ||
          (entry.dataKey === "forecastHours" && !isForecast)
        )
          return null;

        return (
          <p key={idx} style={{ color: entry.color }} className="text-xs">
            {entry.name}: {entry.value.toFixed(1)}h
          </p>
        );
      })}
      {rawData && !isForecast && (
        <div className="mt-1 pt-1 border-t text-xs text-muted-foreground">
          <p>{rawData.employeeCount} Mitarbeiter</p>
          <p>{rawData.shiftCount} Schichten</p>
        </div>
      )}
    </div>
  );
}

// ─── Chart Component ────────────────────────────────────────────────

export function ForecastChart({ dataPoints, summary }: ForecastChartProps) {
  // Find the index where forecast starts
  const forecastStartIdx = dataPoints.findIndex((d) => d.isForecast);

  // Prepare chart data - merge actual and forecast into display values
  const chartData = dataPoints.map((dp) => ({
    ...dp,
    displayHours: dp.isForecast ? null : dp.actualHours,
    displayForecast: dp.isForecast ? dp.forecastHours : null,
    // For the uncertainty area, show +/- 15% around forecast
    forecastUpper: dp.isForecast
      ? (dp.forecastHours ?? 0) * 1.15
      : null,
    forecastLower: dp.isForecast
      ? (dp.forecastHours ?? 0) * 0.85
      : null,
    // Connect the last actual point to the first forecast point
    ...(dp.isForecast
      ? {}
      : {
          forecastUpper: null,
          forecastLower: null,
        }),
  }));

  // Make the forecast connect smoothly from the last actual value
  if (forecastStartIdx > 0 && forecastStartIdx < chartData.length) {
    const lastActual = chartData[forecastStartIdx - 1];
    chartData[forecastStartIdx - 1] = {
      ...lastActual,
      displayForecast: lastActual.actualHours,
      forecastUpper: lastActual.actualHours,
      forecastLower: lastActual.actualHours,
    };
  }

  return (
    <div className="space-y-4">
      <div className="h-[350px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              label={{
                value: "Stunden",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 12, fill: "#94a3b8" },
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            />

            {/* Forecast start line */}
            {forecastStartIdx > 0 && (
              <ReferenceLine
                x={chartData[forecastStartIdx]?.label}
                stroke="#94a3b8"
                strokeDasharray="3 3"
                label={{
                  value: "Prognose",
                  position: "top",
                  fill: "#94a3b8",
                  fontSize: 11,
                }}
              />
            )}

            {/* Forecast uncertainty area */}
            <Area
              type="monotone"
              dataKey="forecastUpper"
              stackId="forecast-area"
              stroke="none"
              fill="#818cf8"
              fillOpacity={0.1}
              name="Prognose-Bereich"
              connectNulls={false}
            />

            {/* Actual hours line */}
            <Line
              type="monotone"
              dataKey="displayHours"
              stroke="#6366f1"
              strokeWidth={2}
              dot={{ r: 3, fill: "#6366f1" }}
              activeDot={{ r: 5 }}
              name="Ist-Stunden"
              connectNulls={false}
            />

            {/* Moving average line */}
            <Line
              type="monotone"
              dataKey="movingAvg"
              stroke="#a5b4fc"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              name="Gleitender Durchschnitt"
              connectNulls={false}
            />

            {/* Forecast line */}
            <Line
              type="monotone"
              dataKey="displayForecast"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="8 4"
              dot={{ r: 3, fill: "#f59e0b" }}
              name="Prognose"
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* AI Summary */}
      {summary && (
        <div className="rounded-lg bg-accent/50 border border-primary/30 p-4">
          <p className="text-xs font-medium text-primary mb-1">
            KI-Analyse
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {summary}
          </p>
        </div>
      )}
    </div>
  );
}
