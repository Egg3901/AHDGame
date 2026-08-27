/**
 * UK Budget authoring (epic #856, ticket #858).
 *
 * GET  /api/country/[code]/budget → current fiscal-year draft + tax levers +
 *      spending categories + whether the caller is the Chancellor.
 * POST /api/country/[code]/budget  body { taxRates, programLevels, action }
 *      action "save" → draft; "table" → validate, table, and create the
 *      vote-vehicle bill so the Commons votes on it.
 *
 * The Chancellor may author. The Prime Minister acts when that office is vacant.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameState } from "@/lib/gameState";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calculateFiscalYear } from "@/lib/budget/fiscalYear";
import { UK_LAWS } from "@/lib/politicalLegislation/laws/ukLaws";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getEnactedLevels } from "@/lib/politicalLegislation/enactedLevels";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  getBudgetForFiscalYear,
  upsertBudgetDraft,
  tableBudgetWithBill,
} from "@/lib/db/collections/ukBudgets";
import { validateBudget } from "@/lib/uk/budget/budgetValidation";
import {
  buildAnnualBudgetProvisions,
  previewAnnualBudget,
  resolveAnnualBudgetAuthority,
} from "@/lib/uk/budget/annualBudget";

const CHANCELLOR_POSITION_ID = "chancellor";

const bodySchema = z.object({
  taxRates: z.record(z.string(), z.number()),
  programLevels: z.record(z.string(), z.number().int().min(0).max(4)),
  action: z.enum(["preview", "save", "table"]).optional().default("save"),
});

const TAX_LEVERS = UK_LAWS.filter((l) => l.id.startsWith("uk.tax.")).map((l) => ({
  id: l.id,
  label: l.title ?? l.id,
  taxType: l.taxPolicy?.taxType ?? "",
  minRate: l.taxPolicy?.minRate ?? 0,
  maxRate: l.taxPolicy?.maxRate ?? 100,
  step: l.taxPolicy?.step ?? 1,
}));

const PROGRAM_LEVERS = UK_LAWS.filter(
  (law) => law.kind !== "tax" && law.allowedScope !== "regional"
).map((law) => ({
  id: law.id,
  label: law.title,
  category: law.category,
  levels:
    law.levels?.map((level, index) => ({
      level: index,
      label: level.name,
      description: level.description,
    })) ?? [],
}));

async function resolveFiscalYear(db: Awaited<ReturnType<typeof getDb>>): Promise<number> {
  const gameState = await getGameState(db);
  const currentTurn = gameState?.currentTurn ?? 1;
  const startingYear = gameState?.startingYear ?? STARTING_YEAR;
  const currentYear =
    gameState?.currentYear ?? startingYear + Math.floor((currentTurn - 1) / TURNS_PER_YEAR);
  return calculateFiscalYear(currentYear, currentTurn);
}

async function resolveContext(request: Request, code: string) {
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { error: NextResponse.json({ error: "Invalid country" }, { status: 400 }) };
  }
  if (countryId !== "UK") {
    return { error: NextResponse.json({ error: "The Budget is UK-only" }, { status: 400 }) };
  }
  const auth = await requireHumanSessionWithCharacter(request);
  if (!auth.ok) return { error: auth.response };

  const db = await getDb();
  const [chancellor, government] = await Promise.all([
    getCabinetMembersCollection(db).findOne({ countryId, positionId: CHANCELLOR_POSITION_ID }),
    getGovernmentFormationsCollection(db).findOne({ _id: countryId }),
  ]);
  const authority = resolveAnnualBudgetAuthority(
    auth.user.character._id.toString(),
    chancellor?.characterId?.toString() ?? null,
    government?.pmCharacterId?.toString() ?? null
  );
  const fiscalYear = await resolveFiscalYear(db);
  return {
    db,
    countryId,
    fiscalYear,
    isChancellor: authority === "chancellor",
    isActingChancellor: authority === "acting_pm",
    chancellorVacant: !chancellor?.characterId,
    character: auth.user.character,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const ctx = await resolveContext(request, code);
    if ("error" in ctx) return ctx.error;

    const [budget, federalBudget, enactedLevels] = await Promise.all([
      getBudgetForFiscalYear(ctx.db, ctx.fiscalYear),
      ctx.db.collection<FederalBudget>("federalBudget").findOne({ _id: "UK" }),
      getEnactedLevels(ctx.db, "UK"),
    ]);
    return NextResponse.json({
      fiscalYear: ctx.fiscalYear,
      isChancellor: ctx.isChancellor,
      isActingChancellor: ctx.isActingChancellor,
      canAuthor: ctx.isChancellor || ctx.isActingChancellor,
      chancellorVacant: ctx.chancellorVacant,
      taxLevers: TAX_LEVERS.map((lever) => ({
        ...lever,
        currentRate:
          (federalBudget?.taxRates as unknown as Record<string, number> | undefined)?.[
            lever.taxType
          ] ?? 0,
      })),
      programLevers: PROGRAM_LEVERS.map((lever) => ({
        ...lever,
        currentLevel: enactedLevels.get(lever.id) ?? 0,
      })),
      currentFiscal: federalBudget
        ? {
            revenue: federalBudget.revenue.total,
            spending: federalBudget.spending.total,
            gdp: federalBudget.gdp,
            debtPrincipal: federalBudget.debt.principal,
          }
        : null,
      budget: budget
        ? {
            status: budget.status,
            taxRates: budget.taxRates,
            programLevels: budget.programLevels ?? {},
          }
        : null,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const ctx = await resolveContext(request, code);
    if ("error" in ctx) return ctx.error;

    const rl = checkRateLimit(String(ctx.character._id), 20, 60000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    if (!ctx.isChancellor && !ctx.isActingChancellor) {
      return NextResponse.json(
        {
          error:
            "Only the Chancellor, or the Prime Minister while that office is vacant, can author the Budget",
        },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { taxRates, programLevels, action } = parsed.data;

    const valid = validateBudget({ taxRates, programLevels });
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

    if (action === "preview") {
      const preview = await previewAnnualBudget(ctx.db, { taxRates, programLevels });
      return NextResponse.json(preview, { status: preview.ok ? 200 : 400 });
    }

    const now = new Date();
    const draft = await upsertBudgetDraft(ctx.db, {
      fiscalYear: ctx.fiscalYear,
      chancellorCharacterId: ctx.character._id,
      taxRates,
      programLevels,
      now,
    });
    if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 409 });

    if (action === "table") {
      const compiled = await buildAnnualBudgetProvisions(ctx.db, { taxRates, programLevels });
      if (!compiled.ok) return NextResponse.json({ error: compiled.error }, { status: 400 });
      const gameState = await getGameState(ctx.db);
      const tabled = await tableBudgetWithBill(ctx.db, {
        fiscalYear: ctx.fiscalYear,
        chancellorCharacterId: ctx.character._id,
        chancellorName: ctx.character.name,
        chancellorParty: ctx.character.party != null ? String(ctx.character.party) : null,
        currentTurn: gameState?.currentTurn ?? 0,
        now,
        provisions: compiled.provisions,
      });
      if (!tabled.ok) return NextResponse.json({ error: tabled.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, tabled: action === "table" });
  } catch (err) {
    return handleRouteError(err);
  }
}
