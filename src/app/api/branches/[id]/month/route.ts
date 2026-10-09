import { api } from "@/lib/api";
import { requireAccess } from "@/lib/access";
import { berlinDate } from "@/lib/berlin";
import { branchMonth } from "@/lib/overview";

/** GET /api/branches/[id]/month?monat=JJJJ-MM - Monatsdienstplan eines Standorts. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const a = await requireAccess();
    const { id } = await context.params;
    const month = new URL(request.url).searchParams.get("monat") || berlinDate().slice(0, 7);
    return branchMonth(a, id, month);
  });
}
