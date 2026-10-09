import { z } from "zod";
import { api, body, requireMember, serial, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { berlinDate, berlinTime } from "@/lib/berlin";
import { branchForTime } from "@/lib/time-service";
export async function GET() {
  return api(async () => { const m = await requireMember(); return { running: await db.timeRecord.findFirst({ where: { organizationId: m.organizationId, userId: m.userId, type: "WATCH", timeTo: null }, include: { category: true } }) }; });
}
export async function POST(request: Request) {
  return api(async () => {
    const m = await requireMember();
    const data = await body(request, z.object({ action: z.enum(["START", "PAUSE", "RESUME", "STOP"]), categoryId: z.string().optional(), comment: z.string().max(1000).optional() }));
    return serial(async tx => {
      if (data.categoryId && !await tx.timeCategory.findFirst({ where: { id: data.categoryId, organizationId: m.organizationId, enabled: true } })) throw new ApiError("Kategorie nicht gefunden.");
      const where = { organizationId: m.organizationId, userId: m.userId, type: "WATCH" as const, timeTo: null };
      const running = await tx.timeRecord.findFirst({ where });
      const now = new Date();
      if (data.action === "START") {
        if (running) throw new ApiError("Die Zeiterfassung läuft bereits.", 409);
        return { record: await tx.timeRecord.create({ data: { organizationId: m.organizationId, userId: m.userId, type: "WATCH", date: new Date(berlinDate(now)), timeFrom: berlinTime(now), startedAt: now, categoryId: data.categoryId, comment: data.comment } }) };
      }
      if (!running) throw new ApiError("Keine laufende Zeiterfassung gefunden.", 404);
      if (data.action === "PAUSE") {
        if (running.pauseStartedAt) throw new ApiError("Die Pause läuft bereits.", 409);
        return { record: await tx.timeRecord.update({ where: { id: running.id }, data: { pauseStartedAt: now } }) };
      }
      if (data.action === "RESUME" && !running.pauseStartedAt) throw new ApiError("Es läuft keine Pause.", 409);
      const breakSeconds = running.breakSeconds + (running.pauseStartedAt ? Math.max(0, Math.round((now.getTime() - running.pauseStartedAt.getTime()) / 1000)) : 0);
      // Beim Beenden steht der Zeitraum fest: Standort nach der Zuordnungsregel.
      const branchId = data.action === "STOP" ? await branchForTime(tx, m.organizationId, m.userId, { date: running.date.toISOString().slice(0, 10), timeFrom: running.timeFrom, timeTo: berlinTime(now) }) : undefined;
      return { record: await tx.timeRecord.update({ where: { id: running.id }, data: { breakSeconds, pauseStartedAt: null, ...(data.action === "STOP" ? { endedAt: now, timeTo: berlinTime(now), branchId, categoryId: data.categoryId || running.categoryId, comment: data.comment ?? running.comment } : {}) } }) };
    });
  });
}
