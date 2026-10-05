import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import type { FederalBudget } from "@/lib/db/types/budget";
import { resolveGameYear } from "@/lib/era/era";
import { getGameState } from "@/lib/gameState";
import {
  getDepartmentDefinitions,
  type DepartmentCountryId,
} from "@/lib/governmentFinance/departmentCatalog";
import { validateDepartmentProgramAllocations } from "@/lib/governmentFinance/departmentAllocation";
import { getDb } from "@/lib/mongodb";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import { setResetDepartmentAllocations } from "@/lib/resetCabinet/setDepartmentAllocations";

const schema = z.object({
  departmentId: z.string().min(1),
  programAllocationPercents: z.record(z.string(), z.number().min(0).max(200)),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId] || !["US", "UK", "JP"].includes(countryId)) {
      return errorResponse(400, "Invalid country");
    }
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const db = await getDb();
    const gameState = await getGameState(db);
    const cabinetV2 =
      resetSystemVersionsForCountry(gameState, RESET_V2_READY, countryId).cabinet === "v2";
    if (cabinetV2) {
      const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
      const isHolder =
        member?.characterId &&
        auth.user.character &&
        member.characterId.toString() === auth.user.character._id.toString();
      if (!isHolder && !auth.user.isAdmin) {
        return errorResponse(
          403,
          "Only the cabinet holder or admin can set department allocations"
        );
      }
      const result = await setResetDepartmentAllocations({
        db,
        worldId: String(gameState?.resetWorldId ?? ""),
        countryId: countryId as "US" | "UK" | "JP",
        departmentId: parsed.data.departmentId,
        positionId,
        turn: gameState?.currentTurn ?? 0,
        actorId: auth.user.character?._id.toString() ?? auth.user.userId,
        allocations: parsed.data.programAllocationPercents,
      });
      return NextResponse.json(result.ok ? { success: true } : { error: result.error }, {
        status: result.ok ? 200 : result.status,
      });
    }
    if (gameState?.departmentFinanceEnabled !== true) {
      return errorResponse(404, "Department finance is not enabled");
    }
    const definition = getDepartmentDefinitions(
      countryId as DepartmentCountryId,
      resolveGameYear(gameState),
      new Set(gameState.manuallyEnabledSeats ?? [])
    ).find(
      (candidate) =>
        candidate.id === parsed.data.departmentId &&
        candidate.controllingPositionIds.includes(positionId)
    );
    if (!definition?.accountPolicyId) {
      return errorResponse(403, "This office does not control that department account");
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the cabinet holder or admin can set department allocations");
    }

    const accountPath = `departmentAccounts.${definition.id}`;
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId }, { projection: { [accountPath]: 1 } });
    const account = budget?.departmentAccounts?.[definition.id];
    if (!account) {
      return errorResponse(404, "This department has no settled account yet");
    }
    const activeProgramIds = Object.values(account.programs)
      .filter((program) => program.status === "authorized" || program.status === "operating")
      .map((program) => program.programId);
    if (activeProgramIds.length === 0) {
      return errorResponse(400, "This department has no active programs");
    }
    const validation = validateDepartmentProgramAllocations(
      activeProgramIds,
      parsed.data.programAllocationPercents
    );
    if (!validation.ok) {
      return errorResponse(400, validation.error);
    }

    const currentTurn = gameState.currentTurn ?? 1;
    if ((account.lastAllocationChangedTurn ?? 0) >= currentTurn) {
      return errorResponse(400, "Department allocations can only be updated once per turn");
    }
    const lastChangedPath = `${accountPath}.lastAllocationChangedTurn`;
    const result = await db.collection<FederalBudget>("federalBudget").updateOne(
      {
        countryId,
        [accountPath]: { $exists: true },
        [`${accountPath}.accruedThroughTurn`]: account.accruedThroughTurn,
        $or: [
          { [lastChangedPath]: { $exists: false } },
          { [lastChangedPath]: { $lt: currentTurn } },
        ],
      },
      {
        $set: {
          [`${accountPath}.programAllocationPercents`]: parsed.data.programAllocationPercents,
          [lastChangedPath]: currentTurn,
          [`${accountPath}.lastAllocationChangedBy`]:
            auth.user.character?._id.toString() ?? auth.user.userId,
        },
      }
    );
    if (result.modifiedCount === 0) {
      return errorResponse(409, "Department allocations changed. Refresh and try again.");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
