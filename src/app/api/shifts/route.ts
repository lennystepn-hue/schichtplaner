import { api, body, serial } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { createShifts, shiftInput } from "@/lib/shift-service";
import { shiftView } from "@/lib/planning";
import { emitToBranch } from "@/lib/emit";

export async function POST(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const data = await body(request, shiftInput);
    const shifts = await serial(tx => createShifts(tx, a, data));
    emitToBranch(a.orgId, shifts[0]?.schedule.branchId ?? null, "schedule:updated");
    return { shifts: shifts.map(s => shiftView(s, a)) };
  });
}
