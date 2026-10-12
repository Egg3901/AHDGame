import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { cancelBankFundSubscription } from "@/lib/indexFunds/subscriptions";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ operationId: string }> }
) {
  try {
    const auth = await getAuthUserWithCharacter();
    if (!auth?.character?._id) return errorResponse(401, "An active character is required.");
    const { operationId } = await params;
    if (!z.string().uuid().safeParse(operationId).success)
      return errorResponse(400, "Invalid order ID.");
    return cancelBankFundSubscription(await getDb(), auth.character._id, operationId);
  } catch (error) {
    return handleRouteError(error);
  }
}
