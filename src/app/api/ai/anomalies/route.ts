import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";
import { isAIFeatureEnabled } from "@/lib/ai/client";
import { detectAnomalies } from "@/lib/ai/anomaly-detector";

/**
 * GET /api/ai/anomalies?month=2026-03
 *
 * Returns anomalies detected in time records for the given month.
 * Requires MANAGER+ role and anomalyDetection to be enabled in OrgSettings.
 */
export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json(
      { error: "Nur die Administration kann Anomalien einsehen" },
      { status: 403 }
    );
  }

  // Check feature flag
  const enabled = await isAIFeatureEnabled(
    member.organizationId,
    "anomalyDetection"
  );
  if (!enabled) {
    return NextResponse.json(
      { error: "Anomalie-Erkennung ist fuer diese Organisation deaktiviert" },
      { status: 403 }
    );
  }

  const { searchParams } = request.nextUrl;
  const month = searchParams.get("month");

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid month parameter. Use yyyy-MM format." },
      { status: 400 }
    );
  }

  try {
    const anomalies = await detectAnomalies(member.organizationId, month);

    const summary = {
      total: anomalies.length,
      critical: anomalies.filter((a) => a.severity === "critical").length,
      warning: anomalies.filter((a) => a.severity === "warning").length,
    };

    return NextResponse.json({ anomalies, summary });
  } catch (error) {
    console.error("[AI Anomaly Detection] Error:", error);
    return NextResponse.json(
      { error: "Anomalien konnten nicht erkannt werden" },
      { status: 500 }
    );
  }
}
