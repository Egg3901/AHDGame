/**
 * UK Budget authoring (epic #856, ticket #858).
 *
 * GET  /api/country/[code]/budget → current fiscal-year draft + tax levers +
 *      spending categories + whether the caller is the Chancellor.
 * POST /api/country/[code]/budget  body { taxRates, spendingAllocations, action }
 *      action "save" → draft; "table" → validate, table, and create the
 *      vote-vehicle bill so the Commons votes on it.
 *
 * Only the Chancellor may author. UK only.
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
import { KNOWN_SPENDING_CATEGORIES } from "@/lib/constants/economicModels";
import { UK_LAWS } from "@/lib/politicalLegislation/laws/ukLaws";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  getBudgetForFiscalYear,
  upsertBudgetDraft,
  tableBudget,
  createBudgetBill,
} from "@/lib/db/collections/ukBudgets";
import { validateBudget } from "@/lib/uk/budget/budgetValidation";

const CHANCELLOR_POSITION_ID = "chancellor";

const bodySchema = z.object({
  taxRates: z.record(z.string(), z.number()),
  spendingAllocations: z.record(z.string(), z.number()),
  action: z.enum(["save", "table"]).optional().default("save"),
});

const TAX_LEVERS = UK_LAWS.filter((l) => l.id.startsWith("uk.tax.")).map((l) => ({
  id: l.id,
  label: l.title ?? l.id,
}));

const SPENDING_CATEGORIES = [...KNOWN_SPENDING_CATEGORIES].sort();

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
  const chancellor = await getCabinetMembersCollection(db).findOne({
    countryId,
    positionId: CHANCELLOR_POSITION_ID,
  });
  const isChancellor = Boolean(
    chancellor?.characterId && auth.user.character._id.equals(chancellor.characterId)
  );
  const fiscalYear = await resolveFiscalYear(db);
  return { db, countryId, fiscalYear, isChancellor, character: auth.user.character };
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const ctx = await resolveContext(request, code);
    if ("error" in ctx) return ctx.error;

    const budget = await getBudgetForFiscalYear(ctx.db, ctx.fiscalYear);
    return NextResponse.json({
      fiscalYear: ctx.fiscalYear,
      isChancellor: ctx.isChancellor,
      taxLevers: TAX_LEVERS,
      spendingCategories: SPENDING_CATEGORIES,
      budget: budget
        ? {
            status: budget.status,
            taxRates: budget.taxRates,
            spendingAllocations: budget.spendingAllocations,
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

    if (!ctx.isChancellor) {
      return NextResponse.json(
        { error: "Only the Chancellor can author the Budget" },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { taxRates, spendingAllocations, action } = parsed.data;

    if (action === "table") {
      const valid = validateBudget({ taxRates, spendingAllocations });
      if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
    }

    const now = new Date();
    const draft = await upsertBudgetDraft(ctx.db, {
      fiscalYear: ctx.fiscalYear,
      chancellorCharacterId: ctx.character._id,
      taxRates,
      spendingAllocations,
      now,
    });
    if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 409 });

    if (action === "table") {
      const tabled = await tableBudget(ctx.db, ctx.fiscalYear, now);
      if (!tabled.ok) return NextResponse.json({ error: tabled.error }, { status: 400 });

      const gameState = await getGameState(ctx.db);
      await createBudgetBill(ctx.db, {
        fiscalYear: ctx.fiscalYear,
        chancellorCharacterId: ctx.character._id,
        chancellorName: ctx.character.name,
        chancellorParty: ctx.character.party != null ? String(ctx.character.party) : null,
        currentTurn: gameState?.currentTurn ?? 0,
        now,
      });
    }

    return NextResponse.json({ ok: true, tabled: action === "table" });
  } catch (err) {
    return handleRouteError(err);
  }
}
