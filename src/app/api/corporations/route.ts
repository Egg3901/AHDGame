import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { loadCampaignCurrencyRates } from "@/lib/campaigns/campaignCurrency";
import { getDb } from "@/lib/mongodb";
import { loadBankingPolicy } from "@/lib/banking/policy";
import {
  DEFAULT_PRIMARY_UNDERWRITING_FEE_RATE,
  primaryUnderwritingCharterEligible,
  quotePrimaryUnderwritingFee,
  type PrimaryUnderwritingOffer,
} from "@/lib/banking/rules/underwriting";
import { settlePrimaryUnderwritingFill } from "@/lib/banking/underwritingSettlement";
import type { TransitionProjection } from "@/lib/banking/rules/boundary";
import { issuanceDilutionFactorExpr } from "@/lib/corporations/shareConsolidation";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { getEraFoundingBounds, getEraFounderShares } from "@/lib/constants/sectorSeedEra";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { foundCorporationSchema } from "@/lib/api/schemas/corporations";
import { randomBrandColor } from "@/lib/corporations/brandColor";
import { handleRouteError } from "@/lib/api/errors";
import type { Character, Corporation, CorporateSector, State, User } from "@/lib/db/types";
import { INACTIVE_CEO_TURN_THRESHOLD } from "@/lib/turn/corporation/inactiveCeoSectorShed";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { openCeoTenure } from "@/lib/corporations/ceoHistory";
import {
  CORPORATION_FOUNDING_COST,
  MIN_CORPORATION_STARTING_CAPITAL,
  MAX_CORPORATION_STARTING_CAPITAL,
  CORPORATION_STARTING_CAPITAL,
  CORPORATION_TYPE_LABELS,
  CEO_INITIAL_SHARES,
  DEFAULT_SHARE_PRICE,
  MIN_SHARE_PRICE,
} from "@/lib/constants/corporations";
import { logWireEvent, wireHeadlineCorpFounded, wireHeadlineCorpIpo } from "@/lib/wireEvent";
import { computeIpoIssuance } from "@/lib/corporations/ipoIssuance";
import {
  computeFoundingCosts,
  getFoundingFxRate,
  getFoundingConfidenceMultiplier,
} from "@/lib/corporations/foundingCosts";
import { foundingCooldownTurnsRemaining } from "@/lib/corporations/foundingCooldown";
import { getDefaultLegalStructureId } from "@/lib/corporations/legalStructure";
import { readInvestorConfidence } from "@/lib/nationalization/investorConfidence";
import { creditTreasuryProceeds } from "@/lib/nationalization/treasury";
import { shouldRedactCorporation, redactPrivateCorporation } from "@/lib/corporations/redaction";
import { emitTx } from "@/lib/financialTxLog/emit";
import { recordAudit } from "@/lib/audit/recordAudit";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getAuthUser } from "@/lib/auth";
import { getGameState } from "@/lib/gameState";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { autoGrantedNodeIds } from "@/lib/constants/techTree";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getPersonalBalance, getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";
import { CURRENCY_SYMBOLS, getSeedCurrencyCode } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { isPrivateEnterpriseBlocked } from "@/lib/economy/queries/privateEnterpriseGate";
import {
  planEquityPrimaryPlacement,
  prepareEquityPrimaryPlacement,
  refundPreparedEquityPlacement,
  type PreparedEquityPlacement,
} from "@/lib/equities/primaryMarket";

const INACTIVE_CEO_THRESHOLD_MS = INACTIVE_CEO_TURN_THRESHOLD * 60 * 60 * 1000;

/**
 * GET /api/corporations?stateId=CA&search=Acme
 * List all corporations with CEO info. Optionally filter by state (HQ or sector presence)
 * and/or by name substring (case-insensitive).
 */
export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    const enabledCountries = isAdmin ? undefined : await getEnabledCountryIds();

    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const stateId = searchParams.get("stateId");
    const search = searchParams.get("search") ?? "";

    // If filtering by state, find corps with sectors in that state or HQ'd there
    const corpFilter: Record<string, unknown> = {};

    if (enabledCountries !== undefined) {
      corpFilter.countryId = { $in: enabledCountries };
    }

    if (stateId) {
      const sectorsInState = await db
        .collection<CorporateSector>("corporateSectors")
        .find({ stateId: stateId.toUpperCase() })
        .project<{ corporationId: ObjectId }>({ corporationId: 1 })
        .toArray();
      const corpIdsFromSectors = sectorsInState.map((s) => s.corporationId);

      corpFilter.$or = [
        { headquartersState: stateId.toUpperCase() },
        { _id: { $in: corpIdsFromSectors } },
      ];
    }

    // Apply case-insensitive name filter when provided (escaped — user input must not be a regex)
    if (search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      corpFilter.name = { $regex: escaped, $options: "i" };
    }

    const corporations = await db
      .collection<Corporation>("corporations")
      .find(corpFilter)
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    // Fetch CEO characters for display
    const ceoIds = corporations.map((c) => c.ceoId).filter((id): id is ObjectId => id != null);
    const characters = await db
      .collection<Character>("characters")
      .find({ _id: { $in: ceoIds } })
      .project<{ _id: ObjectId; name: string; avatarUrl?: string; sequentialId?: number }>({
        _id: 1,
        name: 1,
        avatarUrl: 1,
        sequentialId: 1,
      })
      .toArray();
    const ceoMap = new Map(characters.map((c) => [c._id.toString(), c]));

    // Fetch CEO-owning users to derive ceoIsInactive.
    // Eligibility must mirror inactiveCeoSectorShed.isInactiveCeoPenaltyCandidate exactly,
    // otherwise the UI would flag state-owned/nationalized corps as inactive
    // even though the turn step never sheds them.
    const ceoUserIds = corporations
      .filter(
        (c) =>
          c.userId != null &&
          c.ceoVacant !== true &&
          c.ceoType !== "imperial" &&
          c.countryOwnerId == null &&
          c.isNationalized !== true
      )
      .map((c) => c.userId as ObjectId);
    const ceoUsers =
      ceoUserIds.length > 0
        ? await db
            .collection<User>("users")
            .find({ _id: { $in: ceoUserIds } })
            .project<{ _id: ObjectId; lastActivity?: Date; createdAt?: Date }>({
              _id: 1,
              lastActivity: 1,
              createdAt: 1,
            })
            .toArray()
        : [];
    const ceoUserMap = new Map(ceoUsers.map((u) => [u._id.toString(), u]));
    const inactiveCutoffMs = Date.now() - INACTIVE_CEO_THRESHOLD_MS;

    // Compute per-corp income from sectors (need all sectors of matched corps for total income)
    const corpIds = corporations.map((c) => c._id);
    const allSectors =
      corpIds.length > 0
        ? await db
            .collection<CorporateSector>("corporateSectors")
            .find({ corporationId: { $in: corpIds } })
            .toArray()
        : [];

    const incomeByCorpId = new Map<string, number>();
    for (const sector of allSectors) {
      const corpKey = sector.corporationId.toString();
      const maintenance = sector.revenue * (1 - sector.profitMargin / 100);
      const sectorProfit = sector.revenue - maintenance - sector.currentGrowthCost;
      incomeByCorpId.set(corpKey, (incomeByCorpId.get(corpKey) ?? 0) + sectorProfit);
    }

    // Resolve state names
    const hqStateIds = [...new Set(corporations.map((c) => c.headquartersState))];
    const hqStates =
      hqStateIds.length > 0
        ? await db
            .collection<State>("states")
            .find({ _id: { $in: hqStateIds } })
            .project<{ _id: string; name: string }>({ _id: 1, name: 1 })
            .toArray()
        : [];
    const stateNameMap = new Map(hqStates.map((s) => [s._id, s.name]));

    const viewerUserId = authUser?.userId;
    const viewerIsAdmin = authUser?.isAdmin === true;

    const result = corporations.map((corp) => {
      const ceo = corp.ceoId && !corp.ceoVacant ? ceoMap.get(corp.ceoId.toString()) : undefined;
      const sectorIncome = incomeByCorpId.get(corp._id.toString()) ?? 0;
      const income = sectorIncome - corp.marketingBudget - (corp.ceoSalary ?? 0);

      let ceoIsInactive = false;
      if (
        corp.userId != null &&
        corp.ceoVacant !== true &&
        corp.ceoType !== "imperial" &&
        corp.countryOwnerId == null &&
        corp.isNationalized !== true
      ) {
        const u = ceoUserMap.get(corp.userId.toString());
        const reference = u?.lastActivity ?? u?.createdAt;
        if (reference && reference.getTime() < inactiveCutoffMs) {
          ceoIsInactive = true;
        }
      }

      const fullRow = {
        _id: corp._id,
        sequentialId: corp.sequentialId,
        name: corp.name,
        description: corp.description,
        type: corp.type,
        industryModel: corp.industryModel ?? null,
        typeLabel:
          corp.type === "manufacturing" && corp.industryModel === "vehicles"
            ? "Vehicle manufacturing"
            : CORPORATION_TYPE_LABELS[corp.type],
        headquartersState: corp.headquartersState,
        headquartersStateName: stateNameMap.get(corp.headquartersState) ?? corp.headquartersState,
        liquidCapital: corp.liquidCapital,
        // Every money field on this row (liquidCapital, sharePrice, income)
        // renders in the corp's home currency — UI passes this to formatAmount
        // so wallet preference still drives final display.
        liquidCurrencyCode: corp.liquidCurrencyCode ?? null,
        logoUrl: corp.logoUrl,
        sharePrice: corp.sharePrice ?? DEFAULT_SHARE_PRICE,
        totalShares: corp.totalShares ?? CEO_INITIAL_SHARES,
        income: Math.round(income),
        isPrivate: corp.isPrivate ?? false,
        ceo: ceo
          ? { name: ceo.name, avatarUrl: ceo.avatarUrl, sequentialId: ceo.sequentialId }
          : null,
        ceoIsInactive,
      };
      if (shouldRedactCorporation(corp, viewerUserId, viewerIsAdmin)) {
        const redacted = redactPrivateCorporation(fullRow as Record<string, unknown>);
        return { ...redacted, isPrivate: true };
      }
      return fullRow;
    });

    return NextResponse.json({ corporations: result });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/corporations" });
  }
}

/**
 * POST /api/corporations
 * Found a new corporation. Costs 1M from character funds.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, foundCorporationSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const {
      name,
      tickerSymbol,
      type,
      startingCapital: requestedCapital,
      secondaryType,
      ipo,
    } = parsed.data;
    const db = await getDb();
    // Founding is intentionally exempt from BOTH pause signals:
    // - `isActive === false` (turns paused for registration / settling) — players
    //   must still be able to found during that window (ticket #1009; #1004
    //   wrongly gated this and blocked the iter-4 settle period).
    // - `corporationActionsPaused` — that flag only freezes existing CEOs'
    //   dividend/share/IPO/sector mutations via `requireCorporationActionsEnabled`
    //   on `src/app/api/corporations/[id]/**` (and expand).

    // Get character
    const character = auth.user.character;
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    // Block founding in command-economy countries (USSR etc.). Reads the
    // marketization dial rather than a static config flag, so a country
    // converting in either direction is honoured without a code change.
    if (await isPrivateEnterpriseBlocked(db, character.countryId)) {
      return NextResponse.json(
        {
          error:
            "Private corporations cannot be founded in a command economy. The state controls all enterprise.",
        },
        { status: 403 }
      );
    }

    // Validate secondary type is distinct from primary
    if (secondaryType !== undefined && secondaryType === type) {
      return NextResponse.json(
        { error: "Secondary sector must be different from the primary sector" },
        { status: 400 }
      );
    }

    // Starting capital in anchor currency — defaults to baseline if not provided
    // Era money: the fee, the baseline and the capital bounds all deflate
    // together with starting cash, or founding is unreachable in a 1953 world.
    const worldPreset = await getGameStatePresetOrDefault(db);
    const eraBounds = getEraFoundingBounds(worldPreset, {
      fee: CORPORATION_FOUNDING_COST,
      baseline: CORPORATION_STARTING_CAPITAL,
      min: MIN_CORPORATION_STARTING_CAPITAL,
      max: MAX_CORPORATION_STARTING_CAPITAL,
    });
    const startingCapitalAnchor = requestedCapital ?? eraBounds.baseline;

    // Bounds live here, not in the request schema: they depend on the world's
    // era, which the schema layer cannot see. Messages quote the era's own
    // numbers so a 1953 founder is never told to commit a modern amount.
    if (startingCapitalAnchor < eraBounds.min) {
      return NextResponse.json(
        {
          error: `Starting capital must be at least ${eraBounds.min.toLocaleString()}`,
        },
        { status: 400 }
      );
    }
    if (startingCapitalAnchor > eraBounds.max) {
      return NextResponse.json(
        {
          error: `Starting capital cannot exceed ${eraBounds.max.toLocaleString()}`,
        },
        { status: 400 }
      );
    }

    // HQ defaults to character's home state
    const headquartersState = character.homeState;

    // Check player doesn't already own an active corporation
    const existing = await db
      .collection<Corporation>("corporations")
      .findOne({ ceoId: character._id, ceoVacant: { $ne: true } });
    if (existing) {
      return NextResponse.json(
        { error: "You already own a corporation. Each player can own one corporation." },
        { status: 400 }
      );
    }

    // Bug #0728: per-user founding cooldown. Blocks the found → drain → abandon →
    // found rotation that dodged the per-corp bond cooldown. currentTurnAtFounding
    // is reused below as foundedAtTurn so we read game state only once.
    const foundingGameState = await getGameState();
    const currentTurnAtFounding = foundingGameState?.currentTurn ?? 0;
    const founderUser = await db
      .collection<User>("users")
      .findOne(
        { _id: new ObjectId(auth.user.userId) },
        { projection: { lastCorporationFoundedTurn: 1 } }
      );
    const cooldownRemaining = foundingCooldownTurnsRemaining(
      founderUser?.lastCorporationFoundedTurn,
      currentTurnAtFounding
    );
    if (cooldownRemaining > 0) {
      return NextResponse.json(
        { error: `You can found another corporation in ${cooldownRemaining} turns.` },
        { status: 400 }
      );
    }

    // Check cash on hand (founding costs personal cash, not campaign funds)
    const forexEnabled = await isForexEnabled();
    const homeCurrency = getHomeCurrency(character, worldPreset);

    const corpCountryId = character.countryId as CountryId;
    // Preset-aware: player corps founded in a 2027 euro member stamp EUR, so
    // they match NPP-spawned corps and the seeded EUR exchange rows.
    const corpHomeCurrency: CurrencyCode | undefined = forexEnabled
      ? (getSeedCurrencyCode(corpCountryId, worldPreset) ?? undefined)
      : undefined;
    const underwritingCurrency = (corpHomeCurrency ?? "USD") as CurrencyCode;
    const foundingUnderwriterBank = ipo?.underwriterCorporationId
      ? await (async () => {
          const policy = await loadBankingPolicy(db);
          if (!policy.primaryUnderwriting) return null;
          const bankId = new ObjectId(ipo.underwriterCorporationId);
          const bank = await db.collection<Corporation>("corporations").findOne(
            {
              _id: bankId,
              "bankCharter.status": "active",
              "bankCharter.type": { $in: ["investment", "universal"] },
              "bankCharter.currency": underwritingCurrency,
              "bankCharter.resolutionClaimedTurn": { $exists: false },
              bankCharterTransfer: { $exists: false },
              bankPrimaryFunding: { $exists: false },
              bankUnderwritingFunding: { $exists: false },
              bankConstructionFunding: { $exists: false },
            },
            { projection: { _id: 1, name: 1, bankCharter: 1 } }
          );
          return bank && primaryUnderwritingCharterEligible(bank.bankCharter, underwritingCurrency)
            ? bank
            : null;
        })()
      : null;
    if (ipo?.underwriterCorporationId && !foundingUnderwriterBank) {
      return NextResponse.json(
        { error: "The selected same-currency underwriter is unavailable" },
        { status: 409 }
      );
    }
    // Founder charge AND corp seed are both denominated in the corp's local
    // currency. Scaling only the seed (and leaving the charge in ₳) minted
    // `foundingRate`× free capital for non-USD corps — the money-laundering
    // exploit. computeFoundingCosts converts both legs with the same rate.
    // getFoundingFxRate (stored base rate, never live market rate) is shared with
    // the FoundCorporationModal so the player's preview always matches the
    // charge, and matches migration.ts calibration so corps founded at
    // different exchange levels start equally.
    const foundingRate = getFoundingFxRate(
      corpCountryId,
      forexEnabled,
      await loadCampaignCurrencyRates(db),
      worldPreset
    );
    // Feed-3 (spec §12.4): low investor confidence adds a founding premium. The
    // premium is captured by the country treasury (see the credit below); the
    // FoundCorporationModal computes the same multiplier so preview == charge.
    const investorConfidence = await readInvestorConfidence(db, corpCountryId);
    const confidenceMultiplier = getFoundingConfidenceMultiplier(investorConfidence);
    const {
      corpStartingCapital,
      totalPlayerCost,
      extraCapitalOverBaselineAnchor,
      confidencePremiumLocal,
    } = computeFoundingCosts({
      startingCapitalAnchor,
      foundingRate,
      confidenceMultiplier,
      preset: worldPreset,
    });
    // Founding fee + extra commitment in local currency, for the breakdown message.
    const foundingFeeLocal = Math.round(eraBounds.fee * foundingRate);
    const extraCapitalLocal = Math.round(extraCapitalOverBaselineAnchor * foundingRate);
    // Check against home-currency liquid (same bucket we'll deduct from) so we
    // don't pass a player whose wealth is mostly in savings or foreign currency
    // and then drive their liquid GBP negative on deduct.
    const cashOnHand = getPersonalBalance(character, homeCurrency, forexEnabled);
    if (cashOnHand < totalPlayerCost) {
      const sym = CURRENCY_SYMBOLS[homeCurrency] ?? "$";
      return NextResponse.json(
        {
          error: `Insufficient personal funds. Founding this corporation costs ${sym}${totalPlayerCost.toLocaleString()} (${sym}${foundingFeeLocal.toLocaleString()} founding fee + ${sym}${extraCapitalLocal.toLocaleString()} extra treasury${confidencePremiumLocal > 0 ? ` + ${sym}${confidencePremiumLocal.toLocaleString()} low-confidence premium` : ""}). You have ${sym}${Math.floor(cashOnHand).toLocaleString()} liquid. Withdraw savings or trade FX to top up.`,
        },
        { status: 400 }
      );
    }

    // Check name uniqueness (case-insensitive)
    const nameTaken = await db.collection<Corporation>("corporations").findOne({
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    });
    if (nameTaken) {
      return NextResponse.json(
        { error: "A corporation with that name already exists" },
        { status: 400 }
      );
    }

    // Check ticker uniqueness — schema already uppercased `tickerSymbol`, so an
    // exact match is sufficient (no collation / regex). The unique partial
    // index closes the residual race between this read and the insert below.
    const tickerTaken = await db.collection<Corporation>("corporations").findOne({ tickerSymbol });
    if (tickerTaken) {
      return NextResponse.json({ error: "That ticker symbol is already taken" }, { status: 400 });
    }

    const now = new Date();
    const corporationId = new ObjectId();
    const sequentialId = await getNextSequentialId(db, "corporation");
    // Reuse the turn read for the cooldown check above (single game-state read).
    const foundedAtTurn = currentTurnAtFounding;

    // Starting share price scales with how much equity the founder puts in.
    // At baseline ($1M / 10M shares) this equals DEFAULT_SHARE_PRICE ($0.10).
    // sharePrice is stored in the corp's home currency (Task-18A), matching
    // liquidCapital's denomination; divide LOCAL starting capital by shares so
    // non-USD corps don't start with a ₳-denominated share price that would
    // then be misread as LOCAL by downstream turn / display code.
    //
    // The share base deflates with the era for the same reason the treasury
    // does: on a fixed 10M base a 1953 seed prices at $0.0014 and floors at
    // MIN_SHARE_PRICE, opening the corp at ~7x its own treasury.
    const founderShares = getEraFounderShares(CEO_INITIAL_SHARES, worldPreset);
    const initialSharePrice = Math.max(
      MIN_SHARE_PRICE,
      Math.round((corpStartingCapital / founderShares) * 100) / 100
    );

    // If founding via IPO, issue additional shares to the public float at the offering
    // price and add the proceeds to the corp's treasury. Founder keeps their 10M shares
    // but ends up owning <100% of the (larger) total share count.
    const ipoResult = ipo
      ? computeIpoIssuance({
          existingShares: founderShares,
          pricePerShare: initialSharePrice,
          floatPct: ipo.floatPct,
          withSuperShares: ipo.superShareMultiplier !== undefined,
        })
      : null;
    const foundingOffer: (PrimaryUnderwritingOffer & { instrumentId: ObjectId }) | null =
      ipoResult && foundingUnderwriterBank?.bankCharter
        ? {
            bankCorporationId: foundingUnderwriterBank._id,
            issuerCorporationId: corporationId,
            charteredTurn: foundingUnderwriterBank.bankCharter.charteredTurn,
            currencyCode: underwritingCurrency,
            feeRate: DEFAULT_PRIMARY_UNDERWRITING_FEE_RATE,
            instrumentType: "equity",
            instrumentId: new ObjectId(),
            originalQuoteTurn: foundedAtTurn,
          }
        : null;
    const plannedFoundingPlacement =
      ipoResult && foundingOffer
        ? await planEquityPrimaryPlacement(
            db,
            { countryId: character.countryId, liquidCurrencyCode: corpHomeCurrency },
            ipoResult.newShares,
            initialSharePrice
          )
        : null;
    if (
      plannedFoundingPlacement &&
      (!plannedFoundingPlacement.poolActive || !plannedFoundingPlacement.placedShares)
    ) {
      return NextResponse.json(
        {
          error: "The selected underwriter cannot fund an IPO fill from this market pool right now",
        },
        { status: 409 }
      );
    }
    const foundingPlacement: PreparedEquityPlacement | null = plannedFoundingPlacement
      ? {
          poolActive: true,
          currency: plannedFoundingPlacement.currency,
          requestedShares: plannedFoundingPlacement.requestedShares,
          placedShares: plannedFoundingPlacement.placedShares,
          unsoldShares: plannedFoundingPlacement.unsoldShares,
          paidLocal: plannedFoundingPlacement.plannedGrossLocal,
        }
      : ipoResult
        ? await prepareEquityPrimaryPlacement(
            db,
            {
              countryId: character.countryId,
              liquidCurrencyCode: corpHomeCurrency,
            },
            ipoResult.newShares,
            initialSharePrice,
            now
          )
        : null;
    // Dual-class founding IPO: the founder's initial stake is designated
    // supershares (S#33) — see lib/corporations/superShares.
    const superShareMultiplier = ipo?.superShareMultiplier;
    const placedIpoShares = foundingOffer ? 0 : (foundingPlacement?.placedShares ?? 0);
    const totalSharesAtFounding = founderShares + placedIpoShares;
    const publicFloatAtFounding = placedIpoShares;
    const liquidCapitalAtFounding =
      corpStartingCapital +
      (foundingPlacement?.poolActive && !foundingOffer ? foundingPlacement.paidLocal : 0);
    const publicSharePriceAtFounding =
      foundingPlacement?.poolActive && !foundingOffer && totalSharesAtFounding > 0
        ? (initialSharePrice * founderShares) / totalSharesAtFounding
        : initialSharePrice;

    // Auto-grant past-decade tech (both Corporate and Sector lanes) so late-founded
    // corps start with all the knowledge of bygone decades — including sector-specific
    // unlock nodes that gate production methods. No lane commitment is recorded for
    // past decades since both lanes are granted; the current decade is chosen normally.
    const techGrant: Partial<Corporation> = {};
    if (foundingGameState?.sectorTechTreesEnabled === true) {
      const yearAtFounding =
        foundingGameState?.currentYear ??
        (foundingGameState?.startingYear ?? STARTING_YEAR) +
          Math.floor((Math.max(1, currentTurnAtFounding) - 1) / TURNS_PER_YEAR);
      const grantedIds = autoGrantedNodeIds(type, yearAtFounding);
      if (grantedIds.length > 0) {
        techGrant.unlockedTechNodeIds = grantedIds;
      }
    }

    const foundingUnderwritingProjection =
      foundingOffer && foundingPlacement && ipoResult
        ? (() => {
            const quote = quotePrimaryUnderwritingFee({
              grossPlacedLocal: foundingPlacement.paidLocal,
              feeRate: foundingOffer.feeRate,
            });
            return {
              collection: "corporations",
              filter: {
                _id: corporationId,
                "foundingIpoUnderwritingPending.offer.instrumentId": foundingOffer.instrumentId,
              },
              pipelineUpdate: [
                {
                  $set: {
                    isPrivate: false,
                    hiddenFromExchange: false,
                    legalStructure: getDefaultLegalStructureId(character.countryId, {
                      isPrivate: false,
                    }),
                    lastIpoTurn: foundedAtTurn,
                    totalShares: {
                      $add: [{ $ifNull: ["$totalShares", 0] }, foundingPlacement.placedShares],
                    },
                    publicFloat: {
                      $add: [{ $ifNull: ["$publicFloat", 0] }, foundingPlacement.placedShares],
                    },
                    shareIssuanceProceeds: {
                      $add: [{ $ifNull: ["$shareIssuanceProceeds", 0] }, quote.issuerNetLocal],
                    },
                    sharePrice: {
                      $round: [
                        {
                          $multiply: [
                            { $ifNull: ["$sharePrice", 0] },
                            issuanceDilutionFactorExpr(foundingPlacement.placedShares),
                          ],
                        },
                        4,
                      ],
                    },
                    fundamentalSharePrice: {
                      $round: [
                        {
                          $multiply: [
                            {
                              $ifNull: ["$fundamentalSharePrice", { $ifNull: ["$sharePrice", 0] }],
                            },
                            issuanceDilutionFactorExpr(foundingPlacement.placedShares),
                          ],
                        },
                        4,
                      ],
                    },
                    ...(foundingPlacement.unsoldShares > 0
                      ? {
                          pendingShareIssuance: {
                            remainingShares: foundingPlacement.unsoldShares,
                            requestedShares: ipoResult.newShares,
                            source: "founding_ipo",
                            issuedUpfront: false,
                            createdAtTurn: foundedAtTurn,
                            initialPriceLocal: initialSharePrice,
                            underwriting: foundingOffer,
                          },
                        }
                      : {}),
                    foundingIpoUnderwritingPending: null,
                    updatedAt: now,
                  },
                },
              ],
              note: "Publish funded founding IPO shares and net proceeds",
            } satisfies TransitionProjection;
          })()
        : undefined;
    const corporation: Omit<Corporation, "_id"> = {
      name,
      tickerSymbol,
      description: undefined,
      type,
      ...(secondaryType ? { secondaryType } : {}),
      countryId: character.countryId,
      ceoId: character._id,
      // Explicit — Corporation.ceoType defaults to "character" in docs, but
      // Mongo equality queries (onboarding checklist, buyer-search) do not
      // treat a missing field as that default. Stamp it at founding.
      ceoType: "character",
      ceoVacant: false,
      userId: new ObjectId(auth.user.userId),
      headquartersState,
      liquidCapital: liquidCapitalAtFounding,
      ...(forexEnabled && corpHomeCurrency ? { liquidCurrencyCode: corpHomeCurrency } : {}),
      marketingBudget: 0,
      marketingStrength: 10,
      logisticsBudget: 0,
      logisticsStrength: 0,
      ceoSalary: 0,
      totalShares: totalSharesAtFounding,
      sharePrice: publicSharePriceAtFounding,
      shareholders: [
        {
          characterId: character._id,
          shares: founderShares,
          ...(superShareMultiplier !== undefined ? { superShares: founderShares } : {}),
        },
      ],
      publicFloat: publicFloatAtFounding,
      ...(foundingPlacement?.poolActive && foundingPlacement.paidLocal > 0 && !foundingOffer
        ? { shareIssuanceProceeds: foundingPlacement.paidLocal }
        : {}),
      ...(foundingPlacement && foundingPlacement.unsoldShares > 0 && !foundingOffer
        ? {
            pendingShareIssuance: {
              remainingShares: foundingPlacement.unsoldShares,
              requestedShares: ipoResult!.newShares,
              source: "founding_ipo" as const,
              createdAtTurn: foundedAtTurn,
              initialPriceLocal: initialSharePrice,
            },
          }
        : {}),
      // Every corp gets a colour at founding. It drives the cap-table charts and
      // every place the corp appears next to rivals, and a random pick beats a
      // shared default: two corps side by side are told apart on sight.
      brandColor: randomBrandColor(),
      isPrivate: ipoResult && !foundingOffer ? false : true,
      // Private founding uses the jurisdiction's private form (e.g. UK Ltd),
      // not the public default (PLC) — otherwise the hero shows "Private PLC".
      legalStructure: getDefaultLegalStructureId(character.countryId, {
        isPrivate: !ipoResult || !!foundingOffer,
      }),
      foundedAtTurn,
      ...(ipoResult && !foundingOffer ? { lastIpoTurn: foundedAtTurn } : {}),
      ...(foundingOffer
        ? {
            primaryUnderwritingMandate: {
              bankCorporationId: foundingOffer.bankCorporationId,
              charteredTurn: foundingOffer.charteredTurn,
              currencyCode: foundingOffer.currencyCode,
              feeRate: foundingOffer.feeRate,
              selectedAtTurn: foundedAtTurn,
            },
            foundingIpoUnderwritingPending: {
              offer: foundingOffer,
              grossPlacedLocal: foundingPlacement!.paidLocal,
              turn: foundedAtTurn,
              instrumentProjection: foundingUnderwritingProjection!,
            },
          }
        : {}),
      ...(superShareMultiplier !== undefined
        ? { superShareMultiplier, superSharesAdoptedAtTurn: foundedAtTurn }
        : {}),
      sequentialId,
      ...techGrant,
      createdAt: now,
      updatedAt: now,
    };

    // Atomic balance-gated debit on the founder's cash, BEFORE the corp
    // insert. Pre-fix path read cashOnHand on the cached character doc and
    // ran a separate naïve $inc — same race window the bond-buy fix closed.
    // Order: debit first, insert second; matches the bond/share-buy pattern
    // (cash committed before side effect) and avoids leaving an orphan corp
    // doc if the debit fails for any reason.
    const debitResult = await atomicallyDebitCharacterCash(
      db,
      character._id,
      homeCurrency,
      totalPlayerCost,
      forexEnabled
    );
    if (!debitResult.ok) {
      if (foundingPlacement && !foundingOffer) {
        await refundPreparedEquityPlacement(db, foundingPlacement, now);
      }
      const sym = CURRENCY_SYMBOLS[homeCurrency] ?? "$";
      return NextResponse.json(
        {
          error: `Insufficient personal funds. Founding this corporation costs ${sym}${totalPlayerCost.toLocaleString()}.`,
        },
        { status: 400 }
      );
    }

    let createdCorporationId: ObjectId | null = null;
    let foundingSettlementStarted = false;
    let foundingSettlementPending = false;
    let foundingSettlementAborted = false;
    try {
      const result = await db
        .collection<Corporation>("corporations")
        .insertOne({ _id: corporationId, ...corporation } as Corporation);
      createdCorporationId = result.insertedId;

      if (foundingOffer && foundingUnderwriterBank && foundingUnderwritingProjection) {
        // The private shell and frozen publication plan exist before settlement.
        // If the process stops here, corporation-turn recovery resumes the
        // exact plan; no public shares or proceeds exist until its journal ACKs.
        foundingSettlementStarted = true;
        const settlement = await settlePrimaryUnderwritingFill(db, {
          bank: foundingUnderwriterBank,
          issuer: { _id: result.insertedId, name },
          issuerCurrencyCode: underwritingCurrency,
          offer: foundingOffer,
          instrumentId: foundingOffer.instrumentId,
          grossPlacedLocal: foundingPlacement!.paidLocal,
          turn: foundedAtTurn,
          now,
          poolCollection: "equityMarketPools",
          instrumentProjection: foundingUnderwritingProjection,
        });
        if (settlement.status === "applied" || settlement.status === "replayed") {
          const quote = quotePrimaryUnderwritingFee({
            grossPlacedLocal: foundingPlacement!.paidLocal,
            feeRate: foundingOffer.feeRate,
          });
          void emitTx(db, {
            type: "ipo_proceeds",
            turn: foundedAtTurn,
            createdAt: now,
            subjectType: "corporation",
            subjectId: result.insertedId,
            subjectName: name,
            amount: quote.issuerNetLocal,
            currencyCode: underwritingCurrency,
            meta: {
              grossPlacedLocal: quote.grossPlacedLocal,
              underwritingFeeLocal: quote.feeLocal,
              sharesPlaced: foundingPlacement!.placedShares,
              sharesRequested: foundingPlacement!.requestedShares,
              sharesPending: foundingPlacement!.unsoldShares,
              counterparty: "equity_market_pool",
            },
          });
        } else if (settlement.status === "rejected" && settlement.appliedLegs.length === 0) {
          await db.collection<Corporation>("corporations").updateOne(
            {
              _id: result.insertedId,
              "foundingIpoUnderwritingPending.offer.instrumentId": foundingOffer.instrumentId,
            },
            { $unset: { foundingIpoUnderwritingPending: "" }, $set: { updatedAt: now } }
          );
          foundingSettlementStarted = false;
          foundingSettlementAborted = true;
        } else {
          foundingSettlementPending = true;
        }
      }

      // Open the founder's CEO tenure so later departures stamp an endTurn
      // (needed for the former-CEO bond-purchase block).
      await openCeoTenure(db, result.insertedId, {
        holderId: character._id,
        ceoType: corporation.ceoType === "imperial" ? "imperial" : "character",
        turn: foundedAtTurn,
      });

      await db
        .collection<Character>("characters")
        .updateOne({ _id: character._id }, { $set: { updatedAt: now } });

      // Auto-vote the founder as CEO so the vote record exists from creation
      await db.collection("corporationCeoVotes").insertOne({
        corporationId: result.insertedId,
        voterCharacterId: character._id,
        candidateCharacterId: character._id,
        createdAt: now,
        updatedAt: now,
      });

      // Financial ledger entries — pre-Phase-3 corp founding moved cash silently
      // (player → corp + system grant + founding fee), leaving no record in the
      // financial ledger. Phase 3 emits both legs:
      //   - corp_capital_seed on the character: NEGATIVE-amount debit covering
      //     founding fee + extra treasury commitment, counterparty = corporation
      //   - corp_capital_seed on the corp: POSITIVE-amount credit covering the
      //     full starting capital landing in liquidCapital, counterparty = character
      // The delta between the two (= CORPORATION_STARTING_CAPITAL minus the
      // founding fee) represents the system's baseline grant + fee retention,
      // captured in meta for forensics.
      void emitTx(db, {
        type: "corp_capital_seed",
        turn: 0,
        createdAt: now,
        subjectType: "character",
        subjectId: character._id,
        subjectName: character.name,
        amount: -totalPlayerCost,
        currencyCode: homeCurrency,
        counterpartyType: "corporation",
        counterpartyId: result.insertedId,
        counterpartyName: name,
        meta: {
          foundingFee: eraBounds.fee,
          extraCapitalCommitment: extraCapitalOverBaselineAnchor,
          side: "founder_outflow",
        },
      });
      void emitTx(db, {
        type: "corp_capital_seed",
        turn: 0,
        createdAt: now,
        subjectType: "corporation",
        subjectId: result.insertedId,
        subjectName: name,
        amount: corpStartingCapital,
        currencyCode: (corpHomeCurrency as CurrencyCode | undefined) ?? homeCurrency,
        counterpartyType: "character",
        counterpartyId: character._id,
        counterpartyName: character.name,
        meta: {
          startingCapitalAnchor,
          baselineCapital: CORPORATION_STARTING_CAPITAL,
          extraCapitalCommitment: extraCapitalOverBaselineAnchor,
          side: "corp_seed",
        },
      });

      // Feed-3: the low-confidence founding premium is part of totalPlayerCost
      // (already debited from the founder above) but does NOT land in the corp
      // seed. Move it to the country treasury so money is conserved (no burn),
      // and ledger the leg. Zero at/above baseline confidence ⇒ no-op.
      if (confidencePremiumLocal > 0) {
        await creditTreasuryProceeds(db, corpCountryId, confidencePremiumLocal, now);
        void emitTx(db, {
          type: "corp_capital_seed",
          turn: 0,
          createdAt: now,
          subjectType: "government",
          countryId: corpCountryId,
          subjectName: `${corpCountryId} Treasury`,
          amount: confidencePremiumLocal,
          currencyCode: (corpHomeCurrency as CurrencyCode | undefined) ?? homeCurrency,
          counterpartyType: "character",
          counterpartyId: character._id,
          counterpartyName: character.name,
          meta: {
            side: "founding_confidence_premium",
            investorConfidence,
            confidenceMultiplier,
          },
        });
      }

      if (foundingPlacement?.poolActive && foundingPlacement.paidLocal > 0 && !foundingOffer) {
        void emitTx(db, {
          type: "ipo_proceeds",
          turn: foundedAtTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: result.insertedId,
          subjectName: name,
          amount: foundingPlacement.paidLocal,
          currencyCode: (corpHomeCurrency as CurrencyCode | undefined) ?? homeCurrency,
          meta: {
            sharesPlaced: foundingPlacement.placedShares,
            sharesRequested: foundingPlacement.requestedShares,
            sharesPending: foundingPlacement.unsoldShares,
            counterparty: "equity_market_pool",
          },
        });
      }

      const typeLabel = CORPORATION_TYPE_LABELS[type] ?? type;
      const hqStateDoc = await db
        .collection<State>("states")
        .findOne({ _id: headquartersState }, { projection: { name: 1 } });
      const hqDisplayName = hqStateDoc?.name ?? headquartersState;
      logWireEvent("corporation_founded", wireHeadlineCorpFounded(name, typeLabel, hqDisplayName), {
        href: `/corporation/${sequentialId}`,
      });

      recordAudit({
        source: "api",
        action: "corp.found",
        category: "corp",
        actor: {
          kind: "player",
          userId: new ObjectId(auth.user.userId),
          characterId: character._id,
          name: character.name,
        },
        subject: { type: "corporation", id: result.insertedId, name },
        amount: -totalPlayerCost,
        currencyCode: homeCurrency,
        refs: { corporationId: result.insertedId },
        outcome: "ok",
        meta: { type, headquartersState, isPublicIpo: !!ipoResult },
      });

      if (ipoResult && ipo && !foundingSettlementPending && !foundingSettlementAborted) {
        logWireEvent("corporation_ipo", wireHeadlineCorpIpo(name, ipo.floatPct), {
          href: `/corporation/${sequentialId}`,
        });
      }

      // Bug #0728: arm the per-user founding cooldown. Stamped last, after every
      // rollback-tracked write, so a failed founding (which the catch fully
      // reverses) never leaves a user cooled down with no corporation.
      await db
        .collection<User>("users")
        .updateOne(
          { _id: new ObjectId(auth.user.userId) },
          { $set: { lastCorporationFoundedTurn: foundedAtTurn } }
        );

      if (foundingSettlementPending) {
        return NextResponse.json(
          {
            corporationId: result.insertedId.toString(),
            sequentialId,
            message: `${name} has been founded privately while its funded IPO settlement completes.`,
            settlementPending: true,
          },
          { status: 202 }
        );
      }
      foundingSettlementStarted = false;
      return NextResponse.json(
        {
          corporationId: result.insertedId.toString(),
          sequentialId,
          message: foundingSettlementAborted
            ? `${name} has been founded privately; the selected bank could not fund the IPO. No public shares or proceeds were issued.`
            : `${name} has been founded!`,
        },
        { status: 201 }
      );
    } catch (error) {
      if (foundingSettlementStarted) {
        // The settlement may have committed one or more cash legs. Keep the
        // frozen shell for journal recovery rather than deleting a paid issuer.
        throw error;
      }
      if (createdCorporationId) {
        await db
          .collection("corporationCeoVotes")
          .deleteMany({ corporationId: createdCorporationId });
        await db.collection<Corporation>("corporations").deleteOne({ _id: createdCorporationId });
      }
      await refundCharacterCash(db, character._id, homeCurrency, totalPlayerCost, forexEnabled);
      if (foundingPlacement && !foundingOffer) {
        await refundPreparedEquityPlacement(db, foundingPlacement, now);
      }
      // Race-loser path: the pre-check above said the ticker was free, but a
      // concurrent founder won the unique-index insert. Translate to the same
      // 400 the pre-check returns instead of bubbling up a 500.
      const code = (error as { code?: number }).code;
      const msg = error instanceof Error ? error.message : String(error);
      if (code === 11000 && msg.includes("tickerSymbol")) {
        return NextResponse.json({ error: "That ticker symbol is already taken" }, { status: 400 });
      }
      throw error;
    }
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/corporations POST" });
  }
}
