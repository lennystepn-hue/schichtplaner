import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember, isAdminOrAbove } from "@/lib/auth-helpers";
import { getEmployeeScores } from "@/lib/ai/employee-recommender";

/**
 * GET /api/ai/recommend?shiftId=xxx
 *
 * Returns a scored employee list for the given shift.
 * Nur fuer die Administration.
 */
export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Die Bewertung vergleicht alle Mitglieder der Organisation und darf
  // deshalb nicht an Standortfreigaben vorbei laufen.
  if (!isAdminOrAbove(member.role)) {
    return NextResponse.json({ error: "Keine Berechtigung." }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const shiftId = searchParams.get("shiftId");

  if (!shiftId) {
    return NextResponse.json(
      { error: "Missing shiftId parameter" },
      { status: 400 }
    );
  }

  // Verify the shift belongs to the user's org
  const shift = await db.shift.findFirst({
    where: {
      id: shiftId,
      deletedAt: null,
      schedule: {
        organizationId: member.organizationId,
        deletedAt: null,
      },
    },
  });

  if (!shift) {
    return NextResponse.json(
      { error: "Schicht nicht gefunden" },
      { status: 404 }
    );
  }

  try {
    const scores = await getEmployeeScores(shiftId, member.organizationId);
    return NextResponse.json({ scores });
  } catch (error) {
    console.error("[AI Recommend] Error:", error);
    return NextResponse.json(
      { error: "Empfehlungen konnten nicht geladen werden" },
      { status: 500 }
    );
  }
}
