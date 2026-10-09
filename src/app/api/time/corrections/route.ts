import { z } from "zod";
import { api, body, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { canSeeTime, requireAccess, timeScope } from "@/lib/access";
import { branchForTime, timeChange, validatedTimeChange } from "@/lib/time-service";
import { notify } from "@/lib/planning";

/**
 * Korrekturen zu Buchungen, die man jetzt noch sehen darf - eigene sowie
 * solche mit Standort- und Personalrecht. Wer eine Korrektur fuer eine andere
 * Person beantragt hat und das Recht verliert, sieht sie nicht mehr.
 */
export async function GET() {
  return api(async () => {
    const a = await requireAccess();
    const corrections = await db.timeCorrection.findMany({
      where: { organizationId: a.orgId, record: timeScope(a, "view") },
      include: { record: { select: { id: true, date: true, userId: true, branchId: true, user: { select: { firstName: true, lastName: true } }, branch: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      corrections: corrections.map((c) => ({
        id: c.id, status: c.status, reason: c.reason, before: c.before, proposed: c.proposed, createdAt: c.createdAt, reviewedAt: c.reviewedAt,
        record: c.record,
        canDecide: c.status === "PENDING" && canSeeTime(a, c.record, "edit"),
      })),
    };
  });
}

export async function PATCH(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { id, status } = await body(request, z.object({ id: z.string(), status: z.enum(["APPROVED", "DECLINED"]) }));
    return serial(async tx => {
      const c = await tx.timeCorrection.findFirst({ where: { id, organizationId: a.orgId }, include: { record: true } });
      const own = c && (c.requesterId === a.userId || c.record.userId === a.userId);
      if (!c || (!own && !canSeeTime(a, c.record, "edit"))) throw new ApiError("Korrektur nicht gefunden.", 404);
      if (!canSeeTime(a, c.record, "edit")) throw new ApiError("Keine Berechtigung.", 403);
      if (c.status !== "PENDING") throw new ApiError("Korrektur bereits entschieden.", 409);
      if (status === "APPROVED") {
        const before = c.before as { updatedAt: string };
        if (before.updatedAt !== c.record.updatedAt.toISOString()) throw new ApiError("Die Zeitbuchung wurde inzwischen geändert. Bitte Antrag ablehnen und neu erfassen.", 409);
        const change = await validatedTimeChange(tx, a.orgId, c.record, timeChange.parse(c.proposed));
        const updated = await tx.timeRecord.update({ where: { id: c.recordId }, data: change });
        // Zuordnungsregel erneut anwenden; ohne eindeutiges Ergebnis bleibt der bisherige Standort.
        const branchId = await branchForTime(tx, a.orgId, updated.userId, { date: updated.date.toISOString().slice(0, 10), timeFrom: updated.timeFrom, timeTo: updated.timeTo });
        if (branchId && branchId !== updated.branchId) await tx.timeRecord.update({ where: { id: updated.id }, data: { branchId } });
      }
      const correction = await tx.timeCorrection.update({ where: { id }, data: { status, reviewedBy: a.userId, reviewedAt: new Date() } });
      await notify(tx, a.orgId, a.userId, [c.record.userId], status === "APPROVED" ? "Zeitkorrektur genehmigt" : "Zeitkorrektur abgelehnt", c.reason);
      return { correction };
    });
  });
}
