/**
 * GET /api/ai/forecast
 *
 * Returns forecast data for the organization: historical hours
 * data points, linear regression forecast, and optional AI summary.
 *
 * Query params:
 *   - summary=true  Include Claude-generated natural language summary
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";
import { isAIFeatureEnabled } from "@/lib/ai/client";
import { generateForecast } from "@/lib/ai/forecast";

export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json(
      { error: "Nur die Administration kann Prognosen einsehen" },
      { status: 403 }
    );
  }

  // Check feature flag
  const enabled = await isAIFeatureEnabled(
    member.organizationId,
    "forecast"
  );
  if (!enabled) {
    return NextResponse.json(
      { error: "Prognose-Feature ist fuer diese Organisation deaktiviert" },
      { status: 403 }
    );
  }

  const { searchParams } = request.nextUrl;
  const generateSummary = searchParams.get("summary") === "true";

  try {
    const forecast = await generateForecast(member.organizationId, {
      generateSummary,
    });

    return NextResponse.json({ forecast });
  } catch (error) {
    console.error("[AI Forecast] Error:", error);
    const message =
      error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json(
      { error: `Prognose konnte nicht erstellt werden: ${message}` },
      { status: 500 }
    );
  }
}
