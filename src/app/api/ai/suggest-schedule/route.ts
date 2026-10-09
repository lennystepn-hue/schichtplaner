import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";
import { generateScheduleSuggestion } from "@/lib/ai/auto-planner";
import { isAIFeatureEnabled, AIError } from "@/lib/ai/client";
import { emitToSchedule } from "@/lib/emit";

const requestSchema = z.object({
  scheduleId: z.string().min(1),
});

/**
 * POST /api/ai/suggest-schedule
 *
 * Generates AI-powered shift assignment suggestions for a schedule.
 * Requires MANAGER+ role and AI autoPlanner feature to be enabled.
 */
export async function POST(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json(
      { error: "Nur die Administration kann KI-Vorschlaege anfordern" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { scheduleId } = parsed.data;

  // Verify schedule exists and belongs to the user's org
  const schedule = await db.schedule.findFirst({
    where: {
      id: scheduleId,
      organizationId: member.organizationId,
      deletedAt: null,
    },
  });

  if (!schedule) {
    return NextResponse.json(
      { error: "Schichtplan nicht gefunden" },
      { status: 404 }
    );
  }

  // Check AI is enabled
  const aiEnabled = await isAIFeatureEnabled(
    member.organizationId,
    "autoPlanner"
  );
  if (!aiEnabled) {
    return NextResponse.json(
      { error: "KI Auto-Planner ist fuer diese Organisation deaktiviert" },
      { status: 403 }
    );
  }

  try {
    const suggestions = await generateScheduleSuggestion(
      scheduleId,
      member.organizationId
    );

    // Enrich suggestions with employee names for the frontend
    const userIds = [...new Set(suggestions.map((s) => s.employeeId))];
    const users = await db.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        profileImage: true,
      },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const enrichedSuggestions = suggestions.map((s) => {
      const user = userMap.get(s.employeeId);
      return {
        ...s,
        employeeName: user
          ? `${user.firstName} ${user.lastName}`
          : "Unbekannt",
        employeeImage: user?.profileImage ?? null,
      };
    });

    // Nur ein Signal an Verbindungen, die den Plan sehen duerfen - ohne Inhalte.
    emitToSchedule(scheduleId, "ai:result");

    return NextResponse.json({ suggestions: enrichedSuggestions });
  } catch (error) {
    if (error instanceof AIError) {
      const status =
        error.code === "RATE_LIMITED"
          ? 429
          : error.code === "AI_DISABLED"
            ? 403
            : 500;

      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
        },
        { status }
      );
    }

    console.error("[AI Suggest Schedule] Error:", error);
    return NextResponse.json(
      { error: "KI-Vorschlag konnte nicht generiert werden" },
      { status: 500 }
    );
  }
}
