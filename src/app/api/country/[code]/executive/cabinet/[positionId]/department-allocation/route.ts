import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
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

const schema = z.object({
  departmentId: z.string().min(1),
  programAllocationPercents: z.record(z.string(), z.number().min(0).max(100)),
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
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const gameState = await getGameState(db);
    if (gameState?.departmentFinanceEnabled !== true) {
      return NextResponse.json({ error: "Department finance is not enabled" }, { status: 404 });
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
      return NextResponse.json(
        { error: "This office does not control that department account" },
        { status: 403 }
      );
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the cabinet holder or admin can set department allocations" },
        { status: 403 }
      );
    }

    const accountPath = `departmentAccounts.${definition.id}`;
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId }, { projection: { [accountPath]: 1 } });
    const account = budget?.departmentAccounts?.[definition.id];
    if (!account) {
      return NextResponse.json(
        { error: "This department has no settled account yet" },
        { status: 404 }
      );
    }
    const activeProgramIds = Object.values(account.programs)
      .filter((program) => program.status === "authorized" || program.status === "operating")
      .map((program) => program.programId);
    if (activeProgramIds.length === 0) {
      return NextResponse.json(
        { error: "This department has no active programs" },
        { status: 400 }
      );
    }
    const validation = validateDepartmentProgramAllocations(
      activeProgramIds,
      parsed.data.programAllocationPercents
    );
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const currentTurn = gameState.currentTurn ?? 1;
    if ((account.lastAllocationChangedTurn ?? 0) >= currentTurn) {
      return NextResponse.json(
        { error: "Department allocations can only be updated once per turn" },
        { status: 400 }
      );
    }
    const lastChangedPath = `${accountPath}.lastAllocationChangedTurn`;
    const result = await db.collection<FederalBudget>("federalBudget").updateOne(
      {
        countryId,
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
      return NextResponse.json(
        { error: "Department allocations changed. Refresh and try again." },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
