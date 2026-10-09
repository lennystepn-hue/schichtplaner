import { api, ApiError } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { monthlyReport, reportPeriod } from "@/lib/report";

export async function GET(request: Request) {
  return api(async () => {
    const a = await requireAccess();
    const { month, year, branchId } = reportPeriod(request);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError("Ungültiger Monat.");
    return monthlyReport(a, month, year, { branchId });
  });
}
