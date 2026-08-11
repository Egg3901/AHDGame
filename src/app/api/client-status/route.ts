import { NextResponse } from "next/server";
import { conditionalJson } from "@/lib/api/conditionalJson";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { calculateFundraisingAmount } from "@/lib/actions";
import { calculateFullFundDistribution, getPopulationTier } from "@/lib/utils/fundGeneration";
import { campaignAnchorToLocal } from "@/lib/campaigns/campaignCurrency";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getTotalPersonalLiquidWealth, getHomeCurrency } from "@/lib/currency/characterFunds";
import { loadFxRatesRecord, corpCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { getExchangeApiKey } from "@/lib/constants/exchangeRegistry";
import { perTurnCouponPayment, BOND_UNIT_FACE_VALUE } from "@/lib/constants/bonds";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { roundMarketingStrength } from "@/lib/utils/formatters";
import { normalizeStatusBarLayout } from "@/lib/statusBar/clientStatusRequest";
import { energyActionLimits } from "@/lib/stats/statDrift";
import { STAT_MIN } from "@/lib/stats/statsConstants";
import {
  computeBonusActions,
  computeClosenessScalar,
  DEFAULT_PARTY_INFLUENCE_MAX_BONUS,
  DEFAULT_PARTY_INFLUENCE_POOL_MULTIPLIER,
} from "@/lib/turn/partyInfluenceTurn";
import {
  estimateCorpDividendPaidLastTurn,
  fetchLatestCorpHistoryDividendRows,
} from "@/lib/corporation/dividendIncomeFromHistory";
import {
  cabinetOfficeTypeForCountry,
  resolveOfficeActionBonus,
} from "@/lib/actions/officeActionBonus";
import type { CountryId } from "@/lib/constants/countries";
import type {
  Bond,
  Character,
  Corporation,
  CorporationHistory,
  Election,
  ElectionCandidate,
  ElectedOfficial,
  ElectionVoteTally,
  PoliticalParty,
  State,
  StatePartyOrg,
  StockExchangeSnapshot,
  User,
} from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";

// GET /api/client-status — Returns status bar enrichment data (funds, corp, election stats, income).
// Auth: requireBasicAuth
// Errors: 401
export async function GET(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const requestedLayout = normalizeStatusBarLayout(
      new URL(request.url).searchParams.get("layout")
    );
    const includeCorp =
      requestedLayout === "standard" || requestedLayout === "corp" || requestedLayout === "full";
    const includeCorpMarket = requestedLayout === "corp" || requestedLayout === "full";
    const includeElection = requestedLayout === "elections" || requestedLayout === "full";

    const userId = auth.user.userId;
    const db = await getDb();

    const [user, forexEnabled] = await Promise.all([
      db.collection<User>("users").findOne({ _id: new ObjectId(userId) }),
      isForexEnabled(),
    ]);
    const forexRates = forexEnabled ? await loadFxRatesRecord(db) : undefined;

    // Check for imperial mode first
    const isImperialMode =
      user?.activeCharacterType === "imperial" && !!user?.activeImperialCharacterId;

    if (isImperialMode) {
      const imperial = await db
        .collection<ImperialCharacter>("imperialCharacters")
        .findOne({ _id: user!.activeImperialCharacterId!, userId: new ObjectId(userId) });
      if (!imperial) {
        return NextResponse.json(
          { status: "no-character" },
          { headers: { "Cache-Control": "private, no-store, no-transform" } }
        );
      }

      // Imperial characters: corporation, dividend income, bond income — no elections/offices
      const [ceoCorp, dividendCorps, holderBonds] = await Promise.all([
        includeCorp
          ? db.collection<Corporation>("corporations").findOne(
              { ceoId: imperial._id, ceoType: "imperial", ceoVacant: { $ne: true } },
              {
                projection: {
                  _id: 1,
                  sequentialId: 1,
                  name: 1,
                  sharePrice: 1,
                  liquidCapital: 1,
                  liquidCurrencyCode: 1,
                  marketingStrength: 1,
                  ceoSalary: 1,
                  countryId: 1,
                },
              }
            )
          : Promise.resolve(null),
        db
          .collection<Corporation>("corporations")
          .find({
            "shareholders.imperialCharacterId": imperial._id,
          })
          .project<{
            _id: ObjectId;
            dividendRate: number;
            totalShares: number;
            liquidCurrencyCode?: string;
            countryId?: string;
            shareholders: {
              imperialCharacterId?: ObjectId;
              characterId?: ObjectId;
              shares: number;
            }[];
          }>({
            _id: 1,
            dividendRate: 1,
            totalShares: 1,
            liquidCurrencyCode: 1,
            countryId: 1,
            shareholders: 1,
          })
          .toArray(),
        db
          .collection<Bond>("bonds")
          .find({
            "holders.imperialCharacterId": imperial._id,
            matured: false,
            defaulted: false,
          })
          .project<{
            couponRate: number;
            currencyCode?: string;
            countryId?: string;
            holders: { imperialCharacterId?: ObjectId; units: number }[];
          }>({ couponRate: 1, currencyCode: 1, countryId: 1, holders: 1 })
          .toArray(),
      ]);

      const latestHistByCorp = await fetchLatestCorpHistoryDividendRows(
        db,
        dividendCorps.map((c) => c._id)
      );

      let dividendIncomePerTurn = 0;
      for (const corp of dividendCorps) {
        const sh = corp.shareholders.find(
          (s) => s.imperialCharacterId?.toString() === imperial._id.toString()
        );
        if (sh && sh.shares > 0 && corp.totalShares > 0) {
          const hist = latestHistByCorp.get(corp._id.toString());
          if (hist) {
            const totalCorpDividendPaidLocal = estimateCorpDividendPaidLastTurn(hist);
            const corpCcy =
              corp.liquidCurrencyCode ??
              (corp.countryId
                ? COUNTRY_CURRENCY_MAP[corp.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
                : undefined);
            const corpFxRate =
              corpCcy && forexRates && forexRates[corpCcy as CurrencyCode]
                ? forexRates[corpCcy as CurrencyCode]!
                : 1.0;
            const totalCorpDividendPaidAnchor = corpCapitalToAnchor(
              totalCorpDividendPaidLocal,
              corpCcy,
              corpFxRate
            );
            dividendIncomePerTurn += totalCorpDividendPaidAnchor * (sh.shares / corp.totalShares);
          }
        }
      }

      // Cross-bond coupon accumulator. Each bond contributes LOCAL in
      // `bond.currencyCode` (Task-18B); anchor-normalize before summing so the
      // status-bar "bondIncome" figure is coherent ₳ for a holder with bonds
      // in multiple currencies. Pre-fix raw sum mixed currencies silently.
      // (Site 25, imperial branch)
      let bondIncomePerTurn = 0;
      for (const bond of holderBonds) {
        const holder = bond.holders?.find(
          (h) => h.imperialCharacterId?.toString() === imperial._id.toString()
        );
        if (!holder?.units) continue;
        const bondCcy = (bond.currencyCode ??
          (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
            ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
            : undefined)) as CurrencyCode | undefined;
        const bondFxRate = bondCcy && forexRates ? forexRates[bondCcy] : undefined;
        const couponLocal =
          perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * holder.units;
        bondIncomePerTurn +=
          bondCcy && bondFxRate && bondFxRate > 0 ? couponLocal / bondFxRate : couponLocal;
      }

      let corpNav: {
        sequentialId: number;
        name: string;
        sharePrice: number;
        priceChange1h: number;
        liquidCapital: number;
        liquidCurrencyCode?: string;
        marketingStrength: number;
        ceoSalary: number;
        history: {
          turn: number;
          sharePrice: number;
          marketingStrength: number;
          liquidCapital: number;
        }[];
      } | null = null;

      if (ceoCorp?.sequentialId != null) {
        // Which stockExchangeSnapshots document holds this corp listing. Venue-less
        // countries fall back to "global" (which lists every corp) rather than to
        // "nyse", where they only ever appeared because of the old exchange bleed.
        const exchangeKey =
          (ceoCorp.countryId ? getExchangeApiKey(ceoCorp.countryId) : undefined) ?? "global";
        const [historyDocs, snapshotListing] = includeCorpMarket
          ? await Promise.all([
              db
                .collection<CorporationHistory>("corporationHistory")
                .find({ corporationId: ceoCorp._id })
                .sort({ turn: -1 })
                .limit(12)
                .project<{
                  turn: number;
                  sharePrice: number;
                  marketingStrength: number;
                  liquidCapital: number;
                }>({ turn: 1, sharePrice: 1, marketingStrength: 1, liquidCapital: 1 })
                .toArray(),
              db
                .collection<StockExchangeSnapshot>("stockExchangeSnapshots")
                .findOne(
                  { _id: exchangeKey, "listings._id": ceoCorp._id },
                  { projection: { "listings.$": 1 } }
                ),
            ])
          : [[], null];
        historyDocs.reverse();
        const priceChange1h = includeCorpMarket
          ? (snapshotListing?.listings?.[0]?.priceChange1h ?? 0)
          : 0;
        corpNav = {
          sequentialId: ceoCorp.sequentialId,
          name: ceoCorp.name,
          sharePrice: ceoCorp.sharePrice,
          priceChange1h,
          liquidCapital: ceoCorp.liquidCapital,
          liquidCurrencyCode: ceoCorp.liquidCurrencyCode,
          marketingStrength: roundMarketingStrength(ceoCorp.marketingStrength ?? 0),
          ceoSalary: ceoCorp.ceoSalary ?? 0,
          history: historyDocs,
        };
      }

      return NextResponse.json(
        {
          name: imperial.name,
          actions: 0,
          funds: 0,
          campaignFundsStored: 0,
          cashOnHand: getTotalPersonalLiquidWealth(imperial, forexEnabled, forexRates),
          personalHomeLiquid: getTotalPersonalLiquidWealth(imperial, forexEnabled),
          homeCurrency: getHomeCurrency(imperial),
          projectedIncome: 0,
          campaignIncomeBreakdown: null,
          donorBaseLevel: 0,
          politicalInfluence: 0,
          favorability: 0,
          currentOfficeType: null,
          isCentralBankChair: false,
          chairActionBonus: 0,
          baseActionsPerTurn: 4,
          officeActionBonus: 0,
          bonusActionsFromParty: 0,
          dividendIncome: Math.round(dividendIncomePerTurn),
          bondIncome: Math.round(bondIncomePerTurn),
          corpNav,
          electionStats: null,
          isImperial: true,
        },
        { headers: { "Cache-Control": "private, no-store, no-transform" } }
      );
    }

    // Resolve character by activeCharacterId if set (admin multi-character), fallback to userId
    const characterQuery = user?.activeCharacterId
      ? { _id: user.activeCharacterId, userId: new ObjectId(userId) }
      : { userId: new ObjectId(userId) };
    const character = await db.collection<Character>("characters").findOne(characterQuery);

    if (!character) {
      return NextResponse.json(
        { status: "no-character" },
        { headers: { "Cache-Control": "private, no-store, no-transform" } }
      );
    }

    const hasParty = Boolean(character.party && character.party !== "independent");
    const statePartyKey = `${character.homeState}_${character.party}`;
    const partySeqId =
      hasParty && typeof character.party === "string" ? parseInt(character.party, 10) : NaN;

    // Main parallel batch — status bar data (+ home state & party rates for CF income)
    const [
      homeState,
      partyDoc,
      statePartyOrg,
      myCandidate,
      ceoCorp,
      currentOfficial,
      dividendCorps,
      holderBonds,
    ] = await Promise.all([
      db
        .collection<State>("states")
        .findOne({ _id: character.homeState, countryId: character.countryId }),
      hasParty && !Number.isNaN(partySeqId)
        ? db.collection<PoliticalParty>("politicalParties").findOne({
            sequentialId: partySeqId,
            countryId: character.countryId ?? "US",
          })
        : Promise.resolve(null),
      hasParty
        ? db.collection<StatePartyOrg>("statePartyOrg").findOne({ _id: statePartyKey })
        : Promise.resolve(null),
      includeElection
        ? db
            .collection<ElectionCandidate>("electionCandidates")
            .findOne({ characterId: character._id, status: "active" }, { sort: { enteredAt: -1 } })
        : Promise.resolve(null),
      includeCorp
        ? db.collection<Corporation>("corporations").findOne(
            { ceoId: character._id, ceoVacant: { $ne: true } },
            {
              projection: {
                _id: 1,
                sequentialId: 1,
                name: 1,
                sharePrice: 1,
                liquidCapital: 1,
                liquidCurrencyCode: 1,
                marketingStrength: 1,
                ceoSalary: 1,
                countryId: 1,
              },
            }
          )
        : Promise.resolve(null),
      db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne({ characterId: character._id }, { projection: { officeType: 1 } }),
      // Dividend income: corps where character is a shareholder with a dividend rate
      db
        .collection<Corporation>("corporations")
        .find({ "shareholders.characterId": character._id })
        .project<{
          _id: ObjectId;
          dividendRate: number;
          totalShares: number;
          liquidCurrencyCode?: string;
          countryId?: string;
          shareholders: { characterId?: ObjectId; shares: number }[];
        }>({
          _id: 1,
          dividendRate: 1,
          totalShares: 1,
          liquidCurrencyCode: 1,
          countryId: 1,
          shareholders: 1,
        })
        .toArray(),
      // Bond coupon income: active bonds held by character
      db
        .collection<Bond>("bonds")
        .find({ "holders.characterId": character._id, matured: false, defaulted: false })
        .project<{
          couponRate: number;
          currencyCode?: string;
          countryId?: string;
          holders: { characterId?: ObjectId; units: number }[];
        }>({ couponRate: 1, currencyCode: 1, countryId: 1, holders: 1 })
        .toArray(),
    ]);

    const statePopulation = homeState?.population ?? 0;
    const stateTaxRate = statePartyOrg?.stateTaxRate ?? 0;
    const nationalTaxRate = partyDoc?.nationalTaxRate ?? 0;
    const fundDistribution = calculateFullFundDistribution(
      statePopulation,
      character.donorBaseLevel ?? 0,
      character.currentOffice ?? null,
      stateTaxRate,
      nationalTaxRate,
      homeState?.gdp,
      character.countryId,
      character.politicalInfluence ?? 0
    );
    const populationTier = getPopulationTier(statePopulation);
    // fundDistribution is anchor; campaign funds display in LOCAL at the frozen
    // base INITIAL_RATES scale (same conversion the turn processor deposits), so
    // the tooltip matches the credited amount. Face-formatted client-side (no forex).
    const toCampaignLocal = (anchor: number) =>
      campaignAnchorToLocal(anchor, character.countryId ?? "US");
    const campaignIncomeBreakdown = {
      populationTier,
      baseGen: toCampaignLocal(fundDistribution.baseGeneration),
      donorBonus: toCampaignLocal(fundDistribution.donorBaseBonus),
      officeBonus: toCampaignLocal(fundDistribution.officeBonus),
      stateTax: toCampaignLocal(fundDistribution.stateTaxAmount),
      nationalTax: toCampaignLocal(fundDistribution.nationalTaxAmount),
      totalTax: toCampaignLocal(
        fundDistribution.stateTaxAmount + fundDistribution.nationalTaxAmount
      ),
      netPerTurn: toCampaignLocal(fundDistribution.characterReceives),
    };

    const latestHistByCorp = await fetchLatestCorpHistoryDividendRows(
      db,
      dividendCorps.map((c) => c._id)
    );

    let dividendIncomePerTurn = 0;
    for (const corp of dividendCorps) {
      const sh = corp.shareholders.find(
        (s) => s.characterId?.toString() === character._id.toString()
      );
      if (sh && sh.shares > 0 && corp.totalShares > 0) {
        const hist = latestHistByCorp.get(corp._id.toString());
        if (hist) {
          const totalCorpDividendPaidLocal = estimateCorpDividendPaidLastTurn(hist);
          const corpCcy =
            corp.liquidCurrencyCode ??
            (corp.countryId
              ? COUNTRY_CURRENCY_MAP[corp.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
              : undefined);
          const corpFxRate =
            corpCcy && forexRates && forexRates[corpCcy as CurrencyCode]
              ? forexRates[corpCcy as CurrencyCode]!
              : 1.0;
          const totalCorpDividendPaidAnchor = corpCapitalToAnchor(
            totalCorpDividendPaidLocal,
            corpCcy,
            corpFxRate
          );
          dividendIncomePerTurn += totalCorpDividendPaidAnchor * (sh.shares / corp.totalShares);
        }
      }
    }

    // Cross-bond coupon accumulator. Each bond contributes LOCAL in
    // `bond.currencyCode` (Task-18B); anchor-normalize before summing so the
    // status-bar "bondIncome" figure is coherent ₳ for a holder with bonds in
    // multiple currencies. Pre-fix raw sum mixed currencies silently.
    // (Site 25, character branch)
    let bondIncomePerTurn = 0;
    for (const bond of holderBonds) {
      const holder = bond.holders?.find(
        (h) => h.characterId?.toString() === character._id.toString()
      );
      if (!holder?.units) continue;
      const bondCcy = (bond.currencyCode ??
        (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
          ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
          : undefined)) as CurrencyCode | undefined;
      const bondFxRate = bondCcy && forexRates ? forexRates[bondCcy] : undefined;
      const couponLocal =
        perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * holder.units;
      bondIncomePerTurn +=
        bondCcy && bondFxRate && bondFxRate > 0 ? couponLocal / bondFxRate : couponLocal;
    }

    // Conditional: CEO corp sparkline data
    let corpNav: {
      sequentialId: number;
      name: string;
      sharePrice: number;
      priceChange1h: number;
      liquidCapital: number;
      liquidCurrencyCode?: string;
      marketingStrength: number;
      ceoSalary: number;
      history: {
        turn: number;
        sharePrice: number;
        marketingStrength: number;
        liquidCapital: number;
      }[];
    } | null = null;

    if (ceoCorp?.sequentialId != null) {
      // Which stockExchangeSnapshots document holds this corp listing. Venue-less
      // countries fall back to "global" (which lists every corp) rather than to
      // "nyse", where they only ever appeared because of the old exchange bleed.
      const exchangeKey =
        (ceoCorp.countryId ? getExchangeApiKey(ceoCorp.countryId) : undefined) ?? "global";
      const [historyDocs, snapshotListing] = includeCorpMarket
        ? await Promise.all([
            db
              .collection<CorporationHistory>("corporationHistory")
              .find({ corporationId: ceoCorp._id })
              .sort({ turn: -1 })
              .limit(12)
              .project<{
                turn: number;
                sharePrice: number;
                marketingStrength: number;
                liquidCapital: number;
              }>({ turn: 1, sharePrice: 1, marketingStrength: 1, liquidCapital: 1 })
              .toArray(),
            db
              .collection<StockExchangeSnapshot>("stockExchangeSnapshots")
              .findOne(
                { _id: exchangeKey, "listings._id": ceoCorp._id },
                { projection: { "listings.$": 1 } }
              ),
          ])
        : [[], null];
      historyDocs.reverse();
      const priceChange1h = includeCorpMarket
        ? (snapshotListing?.listings?.[0]?.priceChange1h ?? 0)
        : 0;
      corpNav = {
        sequentialId: ceoCorp.sequentialId,
        name: ceoCorp.name,
        sharePrice: ceoCorp.sharePrice,
        priceChange1h,
        liquidCapital: ceoCorp.liquidCapital,
        liquidCurrencyCode: ceoCorp.liquidCurrencyCode,
        marketingStrength: roundMarketingStrength(ceoCorp.marketingStrength ?? 0),
        ceoSalary: ceoCorp.ceoSalary ?? 0,
        history: historyDocs,
      };
    }

    // Conditional: election stats for active candidacy
    let electionStats: {
      electionId: string;
      isMultiSeat: boolean;
      totalSeats: number | null;
      myVotePct: number;
      marginPct: number | null;
      seatsProjected: number | null;
      history: { turn: number; pct: number; seats: number | null }[];
    } | null = null;

    if (includeElection && myCandidate) {
      const [election, voteTally] = await Promise.all([
        db.collection<Election>("elections").findOne({
          _id: myCandidate.electionId,
          status: { $in: ["upcoming", "active", "completed"] },
        }),
        db
          .collection<ElectionVoteTally>("electionVoteTallies")
          .findOne(
            { electionId: myCandidate.electionId },
            { projection: { totalVotes: 1, seatsEstimate: 1, turnSnapshots: { $slice: -12 } } }
          ),
      ]);

      if (election) {
        const myCandidateKey = myCandidate._id.toString();
        const totalVotes = voteTally?.totalVotes ?? {};
        const totalVotesCast = Object.values(totalVotes).reduce((s, v) => s + v, 0);

        if (totalVotesCast > 0) {
          const myVotes = totalVotes[myCandidateKey] ?? 0;
          const myVotePct = (myVotes / totalVotesCast) * 100;

          const sorted = Object.entries(totalVotes).sort((a, b) => b[1] - a[1]);
          let marginPct: number | null = null;
          if (sorted.length >= 2) {
            const leaderKey = sorted[0][0];
            const leaderPct = (sorted[0][1] / totalVotesCast) * 100;
            const secondPct = (sorted[1][1] / totalVotesCast) * 100;
            marginPct =
              leaderKey === myCandidateKey ? myVotePct - secondPct : myVotePct - leaderPct;
          }

          const seatsProjected =
            (voteTally?.seatsEstimate?.[myCandidateKey] as number | undefined) ?? null;
          const isMultiSeat = !!(election.totalSeats && election.totalSeats > 1);

          const history = (voteTally?.turnSnapshots ?? []).map((snap) => ({
            turn: snap.turn,
            pct: snap.sharesPct?.[myCandidateKey] ?? 0,
            seats: (snap.seatsEstimate?.[myCandidateKey] as number | undefined) ?? null,
          }));

          electionStats = {
            electionId: election._id.toString(),
            isMultiSeat,
            totalSeats: election.totalSeats ?? null,
            myVotePct,
            marginPct,
            seatsProjected,
            history,
          };
        }
      }
    }

    // Central bank chair status — lives on the bank document, not currentOffice.
    // actionRefresh grants `chairActionBonus` on top of any elected-office bonus.
    // Also pull the per-office and base-action config so the StatusBar tooltip
    // can render the exact breakdown actionRefresh actually applies, instead of
    // a hardcoded client table that drifts from gameConfig.
    const [chairBank, gameConfigDoc, cabinetSeat] = await Promise.all([
      db
        .collection("centralBanks")
        .findOne({ chairCharacterId: character._id }, { projection: { _id: 1 } }),
      db
        .collection<{
          _id: string;
          chairActionBonus?: number;
          baseActionsPerTurn?: number;
          officeActionBonus?: Record<string, number>;
          partyInfluenceMaxBonus?: number;
          partyInfluencePoolMultiplier?: number;
        }>("gameConfig")
        .findOne(
          { _id: "default" },
          {
            projection: {
              chairActionBonus: 1,
              baseActionsPerTurn: 1,
              officeActionBonus: 1,
              partyInfluenceMaxBonus: 1,
              partyInfluencePoolMultiplier: 1,
            },
          }
        ),
      // Cabinet seat (unified collection) — its action bonus stacks on the
      // legislative seat, mirroring actionRefresh.
      db
        .collection("cabinetMembers")
        .findOne({ characterId: character._id }, { projection: { countryId: 1 } }),
    ]);
    const isCentralBankChair = chairBank != null;
    const chairActionBonus = isCentralBankChair ? (gameConfigDoc?.chairActionBonus ?? 3) : 0;
    // Mirror the floors that actionRefresh applies so the displayed numbers
    // exactly match what the turn processor grants.
    const baseActionsPerTurn = Math.max(gameConfigDoc?.baseActionsPerTurn ?? 0, 4);
    const officeActionBonus = resolveOfficeActionBonus({
      currentOfficeType: character.currentOffice?.type,
      electedSeatOfficeType: currentOfficial?.officeType,
      isCabinetMember: cabinetSeat != null,
      cabinetOfficeType: cabinetSeat
        ? cabinetOfficeTypeForCountry((cabinetSeat.countryId ?? character.countryId) as CountryId)
        : undefined,
      officeActionBonus: gameConfigDoc?.officeActionBonus,
    });

    // Bonus actions granted by party-influence share (mirrors profile/page.tsx).
    let bonusActionsFromParty = 0;
    if (hasParty && partyDoc) {
      const closeness = computeClosenessScalar(
        character.policies.economic,
        character.policies.social,
        partyDoc.economicPosition,
        partyDoc.socialPosition
      );
      const poolAgg = await db
        .collection<Character>("characters")
        .aggregate<{ totalInfluence: number; memberCount: number }>([
          {
            $match: {
              party: character.party,
              countryId: character.countryId ?? "US",
              isBanned: { $ne: true },
            },
          },
          {
            $group: {
              _id: null,
              totalInfluence: { $sum: "$partyInfluence" },
              memberCount: { $sum: 1 },
            },
          },
        ])
        .toArray();
      const totalInfluence = poolAgg[0]?.totalInfluence ?? 0;
      const memberCount = poolAgg[0]?.memberCount ?? 1;
      const poolMultiplier = Math.max(
        gameConfigDoc?.partyInfluencePoolMultiplier ?? 0,
        DEFAULT_PARTY_INFLUENCE_POOL_MULTIPLIER
      );
      const maxBonus = Math.max(
        gameConfigDoc?.partyInfluenceMaxBonus ?? 0,
        DEFAULT_PARTY_INFLUENCE_MAX_BONUS
      );
      bonusActionsFromParty = computeBonusActions(
        character.partyInfluence ?? 0,
        totalInfluence,
        poolMultiplier * memberCount,
        closeness,
        maxBonus
      );
    }

    // Action cap and hoard threshold scale with the character's Energy stat
    // (engine: actionRefresh.ts → energyActionLimits). Unmigrated characters
    // with no Energy stat fall back to the baseline via STAT_MIN.
    const { cap: actionCap, threshold: hoardThreshold } = energyActionLimits(
      character.stats?.energy ?? STAT_MIN
    );

    const statusPayload = {
      name: character.name,
      actions: character.actions,
      actionCap,
      hoardThreshold,
      // Both fields now expose the LOCAL home-currency balance — the
      // canonical source of truth post-cf-inconsistency-fix.
      funds: character.currencyBalances?.campaign ?? character.funds ?? 0,
      campaignFundsStored: character.currencyBalances?.campaign ?? character.funds ?? 0,
      cashOnHand: getTotalPersonalLiquidWealth(character, forexEnabled, forexRates),
      personalHomeLiquid: getTotalPersonalLiquidWealth(character, forexEnabled),
      homeCurrency: getHomeCurrency(character),
      projectedIncome: toCampaignLocal(
        calculateFundraisingAmount(character.donorBaseLevel ?? 0, character.politicalInfluence ?? 0)
      ),
      campaignIncomeBreakdown,
      donorBaseLevel: character.donorBaseLevel ?? 0,
      politicalInfluence: character.politicalInfluence ?? 0,
      favorability: character.favorability ?? 0,
      currentOfficeType: currentOfficial?.officeType ?? null,
      isCentralBankChair,
      chairActionBonus,
      baseActionsPerTurn,
      officeActionBonus,
      bonusActionsFromParty,
      dividendIncome: Math.round(dividendIncomePerTurn),
      bondIncome: Math.round(bondIncomePerTurn),
      corpNav,
      electionStats,
    };
    // Large per-user status payload. Switch from no-store to a private ETag:
    // stays private (never shared-cached, no cross-user key), but a bodyless
    // 304 on unchanged polls removes the biggest single recurring egress cost.
    return conditionalJson(request, statusPayload, { cacheControl: "private, no-cache" });
  } catch (error) {
    return handleRouteError(error);
  }
}
