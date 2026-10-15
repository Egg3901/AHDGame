import { getAuthUserWithCharacter } from "@/lib/auth";
import { contractContext, contractRouteError, privateJson } from "@/lib/governmentContracts/api";
import { tenderView } from "@/lib/governmentContracts/queries";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const { db, turn, tender } = await contractContext(code, id);
    const user = await getAuthUserWithCharacter();
    return privateJson({ tender: await tenderView(db, tender!, turn, user), currentTurn: turn });
  } catch (e) {
    return contractRouteError(e, request);
  }
}
