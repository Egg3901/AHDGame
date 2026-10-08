import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { snapshotTreasuryCurrency } from "@/lib/ledger/balanceSnapshot";
import type { CorpSnapshot } from "./types";
import type { Corporation } from "@/lib/db/types/corporation";
import { loadTreasuryCashContext } from "@/lib/nationalization/treasuryLedger";
import { settleTransition, resumeSettlement } from "@/lib/banking/settlementJournal";
import { withBankingTelemetryBatch } from "@/lib/banking/telemetry";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";
import { settlePriorCorporateCashArrears } from "./cashArrears";
import { KeyedQueue, interleaveByKey, runInLanes } from "@/lib/turn/settlementLanes";

export { interleaveByKey };

interface OperatingTaxDestinationQuote {
  country: string;
  amountAnchor: number;
  currencyCode: CurrencyCode;
  localPerAnchor: number;
}

interface OperatingCashQuote {
  netLocal: number;
  grossLocal: number;
  sourceCurrency: CurrencyCode;
  sourceLocalPerAnchor: number;
  taxByCountryAnchor: [string, number][];
  taxDestinations: OperatingTaxDestinationQuote[];
}

function readOperatingCashQuote(
  meta: Record<string, unknown> | undefined
): OperatingCashQuote | null {
  const value = meta?.operatingCashQuote;
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const quote = parsed as Partial<OperatingCashQuote>;
  if (
    !Number.isFinite(quote.netLocal) ||
    !Number.isFinite(quote.grossLocal) ||
    typeof quote.sourceCurrency !== "string" ||
    !Number.isFinite(quote.sourceLocalPerAnchor) ||
    !Array.isArray(quote.taxByCountryAnchor) ||
    !Array.isArray(quote.taxDestinations)
  ) {
    return null;
  }
  return quote as OperatingCashQuote;
}

/**
 * Independent corporations settle in a few concurrent lanes. Each receipt is
 * a chain of dependent journal round trips, so one lane per turn made the
 * whole phase as slow as the sum of every corporation's chain.
 */
const OPERATING_CASH_LANES = 8;

/**
 * Settle modeled gross operating receipts before federal withholding. These
 * are separate durable receipts because the settlement journal applies
 * guarded debits before credits: one transition cannot spend income that has
 * not yet landed. Unfunded operating losses and withholding remain explicit
 * corporation arrears rather than aborting the whole corporation turn.
 */
export async function settleCorporateOperatingCash(
  db: Db,
  snapshots: readonly CorpSnapshot[],
  turn: number,
  now: Date,
  lanes: number = OPERATING_CASH_LANES
): Promise<void> {
  return withBankingTelemetryBatch(db, turn, () =>
    settleCorporateOperatingCashBatched(db, snapshots, turn, now, lanes)
  );
}

async function settleCorporateOperatingCashBatched(
  db: Db,
  snapshots: readonly CorpSnapshot[],
  turn: number,
  now: Date,
  lanes: number
): Promise<void> {
  if (snapshots.length === 0) return;
  const context = await loadTreasuryCashContext(db, turn);
  if (!context?.treasuryCashLedgerEnabled) {
    throw new Error(
      "Corporate operating cash settlement requires the enabled Treasury cash ledger"
    );
  }

  const ids = snapshots.map((snapshot) => snapshot.corpId);
  const journals = db.collection<{
    _id: string;
    event?: { meta?: Record<string, unknown> };
  }>("bankMoneyMoves");
  const keys = snapshots.flatMap((snapshot) => {
    const base = `corp-operating-cash:${turn}:${snapshot.corpId.toString()}`;
    return [base, `${base}:net`, `${base}:gross`, `${base}:tax`, `${base}:arrears`];
  });
  const existingRows = await journals
    .find({ _id: { $in: keys } }, { projection: { _id: 1, event: 1 } })
    .toArray();
  const existingKeys = new Set(existingRows.map((row) => row._id));
  const journalByKey = new Map(existingRows.map((row) => [row._id, row]));

  // Finish already claimed gross receipts before taking the corporation cash
  // snapshot used for new work. This keeps the read batched while allowing a
  // retry to spend the proceeds it just replayed.
  // Gross receipts touch only their own corporation, so they resume in lanes.
  const grossResumeKeys = [
    ...new Set(
      snapshots.flatMap((snapshot) => {
        const baseKey = `corp-operating-cash:${turn}:${snapshot.corpId.toString()}`;
        const grossKey = `${baseKey}:gross`;
        return existingKeys.has(baseKey) || !existingKeys.has(grossKey) ? [] : [grossKey];
      })
    ),
  ];
  await runInLanes(grossResumeKeys, lanes, async (grossKey) => {
    const resumed = await resumeSettlement(db, grossKey);
    if (resumed.status !== "applied" && resumed.status !== "replayed") {
      throw new Error(resumed.error ?? `Corporate gross receipt ${grossKey} is incomplete`);
    }
  });

  const corporations = await db
    .collection<Corporation>("corporations")
    .find(
      { _id: { $in: ids } },
      {
        projection: {
          _id: 1,
          liquidCapital: 1,
          operatingCashArrearsByCurrency: 1,
          federalTaxArrearsAnchorByCountry: 1,
        },
      }
    )
    .toArray();
  const corporationById = new Map(corporations.map((corp) => [corp._id.toString(), corp]));
  const cashByCorpId = new Map(
    corporations.map((corp) => [corp._id.toString(), corp.liquidCapital])
  );

  // Every Treasury country this call can credit. Legacy receipts and prior
  // tax arrears hold all of them: their destinations are not known up front,
  // and both paths are rare recovery work.
  const treasuryLock = new KeyedQueue();
  const treasuryKey = (country: string) => `federalBudget:${country}`;
  // Unknown destinations must also serialize with each other when the
  // current snapshots and quotes name no Treasury countries.
  const allTreasuryKeys = new Set<string>(["legacy-treasury-recovery"]);
  for (const snapshot of snapshots) {
    for (const [country] of snapshot.federalTaxByCountryAnchor ?? []) {
      allTreasuryKeys.add(treasuryKey(country));
    }
  }
  for (const row of existingRows) {
    for (const destination of readOperatingCashQuote(row.event?.meta)?.taxDestinations ?? []) {
      allTreasuryKeys.add(treasuryKey(destination.country));
    }
  }
  for (const corp of corporations) {
    for (const country of Object.keys(corp.federalTaxArrearsAnchorByCountry ?? {})) {
      allTreasuryKeys.add(treasuryKey(country));
    }
  }

  // Resolve each Treasury document once for the pass. A settlement whose legs
  // and projections name a selector (countryId) makes the journal look the
  // document up again, twice, before it can claim the receipt; naming the same
  // document by id up front writes the identical journal binding without those
  // reads. A country with no Treasury keeps its selector, so the journal still
  // refuses it exactly as before.
  const treasuryIdByCountry = new Map<string, ObjectId>();
  const treasuryCountries = [...allTreasuryKeys]
    .filter((key) => key.startsWith("federalBudget:"))
    .map((key) => key.slice("federalBudget:".length));
  if (treasuryCountries.length) {
    const rows = await db
      .collection<{ _id: ObjectId; countryId: string }>("federalBudget")
      .find({ countryId: { $in: treasuryCountries } }, { projection: { _id: 1, countryId: 1 } })
      .toArray();
    for (const row of rows)
      if (!treasuryIdByCountry.has(row.countryId)) treasuryIdByCountry.set(row.countryId, row._id);
  }
  const treasuryFilter = (country: string) => {
    const id = treasuryIdByCountry.get(country);
    return id ? { countryId: country, _id: id } : { countryId: country };
  };

  const settleSnapshot = async (snapshot: CorpSnapshot): Promise<void> => {
    const baseKey = `corp-operating-cash:${turn}:${snapshot.corpId.toString()}`;

    // Resume receipts created by the previous implementation before starting
    // the split gross/tax protocol. Its original journal already contains both
    // legs, so applying a second withholding would double-charge the corp.
    if (existingKeys.has(baseKey)) {
      const resumed = await treasuryLock.run(allTreasuryKeys, () => resumeSettlement(db, baseKey));
      if (resumed.status !== "applied" && resumed.status !== "replayed") {
        throw new Error(
          resumed.error ?? `Corporate operating cash receipt ${baseKey} is incomplete`
        );
      }
      return;
    }

    // A combined receipt is complete on its own: it never pairs with a later
    // withholding, so a resume finishes it and stops.
    const netKey = `${baseKey}:net`;
    if (existingKeys.has(netKey)) {
      const resumed = await treasuryLock.run(allTreasuryKeys, () => resumeSettlement(db, netKey));
      if (resumed.status !== "applied" && resumed.status !== "replayed") {
        throw new Error(resumed.error ?? `Corporate net operating receipt ${netKey} is incomplete`);
      }
      return;
    }

    const grossKey = `${baseKey}:gross`;
    const taxKey = `${baseKey}:tax`;
    const frozenRecord = journalByKey.get(grossKey) ?? journalByKey.get(taxKey);
    const savedQuote = readOperatingCashQuote(frozenRecord?.event?.meta);
    if (existingKeys.has(grossKey) && !savedQuote) {
      throw new Error(`Gross receipt ${grossKey} has no complete frozen operating quote`);
    }
    if (!existingKeys.has(grossKey) && existingKeys.has(taxKey) && !savedQuote) {
      const resumed = await treasuryLock.run(allTreasuryKeys, () => resumeSettlement(db, taxKey));
      if (resumed.status !== "applied" && resumed.status !== "replayed") {
        throw new Error(resumed.error ?? `Corporate tax receipt ${taxKey} is incomplete`);
      }
      return;
    }
    const quote =
      savedQuote ??
      (() => {
        const netLocal = snapshot.operatingCashIncomeLocal;
        const sourceCurrency = snapshot.operatingCashCurrency;
        const sourceRate = snapshot.operatingCashLocalPerAnchor;
        if (
          !Number.isFinite(netLocal) ||
          !sourceCurrency ||
          !Number.isFinite(sourceRate) ||
          !(sourceRate! > 0)
        ) {
          throw new Error(`Missing frozen operating cash quote for corporation ${snapshot.corpId}`);
        }
        const taxByCountryAnchor = [
          ...(snapshot.federalTaxByCountryAnchor ?? new Map<string, number>()).entries(),
        ];
        const taxAnchor = taxByCountryAnchor.reduce((sum, [, amount]) => sum + amount, 0);
        const taxDestinations = taxByCountryAnchor
          .filter(([, amount]) => amount > 0)
          .map(([country, amountAnchor]) => {
            const treasuryCurrency =
              context.treasuryCurrencies.get(country) ??
              COUNTRY_CURRENCY_MAP[country as CountryId] ??
              snapshotTreasuryCurrency({ countryId: country as CountryId });
            const treasuryRate = treasuryAnchorValuation({
              countryId: country,
              currencyCode: treasuryCurrency,
              preset: context.preset,
              observedRate: context.rates.get(treasuryCurrency),
            }).anchorRate;
            return {
              country,
              amountAnchor,
              currencyCode: treasuryCurrency,
              localPerAnchor: treasuryRate,
            };
          });
        return {
          netLocal: netLocal!,
          grossLocal: netLocal! + taxAnchor * sourceRate!,
          sourceCurrency: sourceCurrency as CurrencyCode,
          sourceLocalPerAnchor: sourceRate!,
          taxByCountryAnchor,
          taxDestinations,
        } satisfies OperatingCashQuote;
      })();
    const {
      sourceCurrency,
      sourceLocalPerAnchor: sourceRate,
      taxByCountryAnchor,
      taxDestinations,
      grossLocal,
    } = quote;
    const taxByCountry = new Map(taxByCountryAnchor);
    const taxAnchor = taxByCountryAnchor.reduce((sum, [, amount]) => sum + amount, 0);
    const taxSourceLocal = taxAnchor * sourceRate;
    let availableCash = cashByCorpId.get(snapshot.corpId.toString()) ?? 0;
    const originalCorp = corporationById.get(snapshot.corpId.toString());
    const hasOperatingArrears = Object.values(
      originalCorp?.operatingCashArrearsByCurrency ?? {}
    ).some((amount) => amount > 0);
    const hasTaxArrears = Object.values(originalCorp?.federalTaxArrearsAnchorByCountry ?? {}).some(
      (amount) => amount > 0
    );

    // One receipt instead of two when the outcome cannot differ. The split
    // protocol credits gross, then withholds tax guarded by cash >= tax. With
    // no prior payables to settle in between, non-negative net income and
    // non-negative cash, that guard always passes, so minting gross and
    // crediting the corporation its net and each Treasury its tax in one move
    // lands the same balances with about half the journal round trips. Every
    // other case, and any replay of the split protocol, keeps the two moves.
    const settlesNet =
      !savedQuote &&
      !existingKeys.has(grossKey) &&
      !existingKeys.has(taxKey) &&
      !hasOperatingArrears &&
      !hasTaxArrears &&
      grossLocal > 0 &&
      taxSourceLocal > 0 &&
      quote.netLocal >= 0 &&
      availableCash >= 0 &&
      taxByCountryAnchor.every(([, amount]) => amount >= 0) &&
      taxDestinations.length > 0 &&
      taxDestinations.every((destination) => treasuryIdByCountry.has(destination.country));
    if (settlesNet) {
      const valuation = { currencyCode: sourceCurrency, localPerAnchor: sourceRate };
      const corporationLocal = grossLocal - taxSourceLocal;
      const legs: BankingTransition["legs"] = [
        {
          kind: "mint",
          amount: grossLocal,
          valuation,
          note: "Realized modeled gross operating receipts",
        },
      ];
      if (corporationLocal > 0) {
        legs.push({
          kind: "credit",
          amount: corporationLocal,
          valuation,
          collection: "corporations",
          filter: { _id: oid(snapshot.corpId.toString()) },
          path: "liquidCapital",
          note: "Credit realized operating receipts net of tax withholding",
        });
      }
      for (const destination of taxDestinations) {
        const treasuryLocal = destination.amountAnchor * destination.localPerAnchor;
        legs.push({
          kind: "credit",
          amount: treasuryLocal,
          valuation: {
            currencyCode: destination.currencyCode,
            localPerAnchor: destination.localPerAnchor,
          },
          collection: "federalBudget",
          filter: treasuryFilter(destination.country),
          path: "treasuryCashLocal",
          inc: { treasuryBalance: treasuryLocal },
          note: "Deliver withheld corporate tax into spendable Treasury cash and fiscal position",
        });
      }
      const transition: BankingTransition = {
        key: netKey,
        kind: "corporate_operating_net_receipt",
        turn,
        currency: sourceCurrency as CurrencyCode,
        legs,
        projections: [],
        event: {
          kind: "monetary.executed",
          command: "turn.corporation.operatingNetCash",
          subjectType: "corporation",
          subjectId: snapshot.corpId.toString(),
          amount: corporationLocal,
          meta: {
            grossOperatingCashLocal: grossLocal,
            federalTaxAnchor: taxAnchor,
            sourceCurrency,
            sourceLocalPerAnchor: sourceRate,
            operatingCashQuote: JSON.stringify(quote),
          },
        },
      };
      const destinationKeys = taxDestinations.map((destination) =>
        treasuryKey(destination.country)
      );
      const settled = await treasuryLock.run(destinationKeys, () =>
        settleTransition(db, transition)
      );
      if (settled.status !== "applied" && settled.status !== "replayed") {
        throw new Error(settled.error ?? `Corporate net operating receipt ${netKey} is incomplete`);
      }
      return;
    }
    if (existingKeys.has(grossKey)) {
      // Existing quote is restored from the durable gross/loss journal above;
      // cash was refreshed in one batched corporation read after resume.
    } else if (grossLocal > 0) {
      const valuation = { currencyCode: sourceCurrency, localPerAnchor: sourceRate };
      const transition: BankingTransition = {
        key: grossKey,
        kind: "corporate_operating_gross_receipt",
        turn,
        currency: sourceCurrency as CurrencyCode,
        legs: [
          {
            kind: "mint",
            amount: grossLocal,
            valuation,
            note: "Realized modeled gross operating receipts",
          },
          {
            kind: "credit",
            amount: grossLocal,
            valuation,
            collection: "corporations",
            filter: { _id: oid(snapshot.corpId.toString()) },
            path: "liquidCapital",
            note: "Credit realized gross operating receipts before tax withholding",
          },
        ],
        projections: [],
        event: {
          kind: "monetary.executed",
          command: "turn.corporation.operatingGrossCash",
          subjectType: "corporation",
          subjectId: snapshot.corpId.toString(),
          amount: grossLocal,
          meta: {
            grossOperatingCashLocal: grossLocal,
            sourceCurrency,
            sourceLocalPerAnchor: sourceRate,
            operatingCashQuote: JSON.stringify(quote),
          },
        },
      };
      const settled = await settleTransition(db, transition);
      if (settled.status !== "applied" && settled.status !== "replayed") {
        throw new Error(settled.error ?? `Corporate gross receipt ${grossKey} is incomplete`);
      }
      availableCash += grossLocal;
    }

    if (hasOperatingArrears || hasTaxArrears) {
      availableCash = await treasuryLock.run(allTreasuryKeys, () =>
        settlePriorCorporateCashArrears({
          db,
          context,
          corporationId: snapshot.corpId.toString(),
          currencyCode: sourceCurrency as CurrencyCode,
          localPerAnchor: sourceRate,
          turn,
          now,
        })
      );
    }

    if (grossLocal < 0 && !existingKeys.has(grossKey)) {
      // Prior payables settle before the current turn's loss. Any remaining
      // cost becomes a currency-specific payable instead of negative cash.
      const loss = -grossLocal;
      const paidLoss = Math.min(loss, Math.max(0, availableCash));
      const shortfall = loss - paidLoss;
      const legs: BankingTransition["legs"] = [];
      const projections: BankingTransition["projections"] = [];
      const valuation = { currencyCode: sourceCurrency, localPerAnchor: sourceRate };
      if (paidLoss > 0) {
        legs.push(
          {
            kind: "debit",
            amount: paidLoss,
            valuation,
            collection: "corporations",
            filter: { _id: oid(snapshot.corpId.toString()), liquidCapital: { $gte: paidLoss } },
            path: "liquidCapital",
            note: "Pay modeled operating costs from available corporation cash",
          },
          {
            kind: "burn",
            amount: paidLoss,
            valuation,
            note: "Settle funded operating costs outside the corporation",
          }
        );
      }
      if (shortfall > 0) {
        projections.push({
          collection: "corporations",
          filter: { _id: oid(snapshot.corpId.toString()) },
          update: {
            $inc: { [`operatingCashArrearsByCurrency.${sourceCurrency}`]: shortfall },
            $set: {
              [`operatingCashArrearsLastTurnByCurrency.${sourceCurrency}`]: turn,
              updatedAt: now,
            },
          },
          note: "Record the portion of this turn's operating loss not covered by cash",
        });
      }
      const transition: BankingTransition = {
        key: grossKey,
        kind: "corporate_operating_loss",
        turn,
        currency: sourceCurrency as CurrencyCode,
        legs,
        projections,
        event: {
          kind: "monetary.executed",
          command: "turn.corporation.operatingLoss",
          subjectType: "corporation",
          subjectId: snapshot.corpId.toString(),
          amount: -paidLoss,
          meta: {
            grossOperatingCashLocal: grossLocal,
            paidLossLocal: paidLoss,
            shortfallLocal: shortfall,
            sourceCurrency,
            sourceLocalPerAnchor: sourceRate,
            operatingCashQuote: JSON.stringify(quote),
          },
        },
      };
      const settled = await settleTransition(db, transition);
      if (settled.status !== "applied" && settled.status !== "replayed") {
        throw new Error(settled.error ?? `Corporate operating loss ${grossKey} is incomplete`);
      }
    }

    if (!(taxSourceLocal > 0)) return;
    const destinationKeys = taxDestinations.map((destination) => treasuryKey(destination.country));
    const arrearsKey = `${baseKey}:arrears`;
    const recordTaxArrears = async () => {
      if (existingKeys.has(arrearsKey)) {
        const resumed = await resumeSettlement(db, arrearsKey);
        if (resumed.status !== "applied" && resumed.status !== "replayed") {
          throw new Error(resumed.error ?? `Corporate tax arrears ${arrearsKey} is incomplete`);
        }
        return;
      }
      const arrears: BankingTransition = {
        key: arrearsKey,
        kind: "corporate_tax_arrears",
        turn,
        currency: sourceCurrency as CurrencyCode,
        legs: [],
        projections: [
          {
            collection: "corporations",
            filter: { _id: oid(snapshot.corpId.toString()) },
            update: {
              $inc: Object.fromEntries(
                [...taxByCountry]
                  .filter(([, amount]) => amount > 0)
                  .map(([country, amount]) => [
                    `federalTaxArrearsAnchorByCountry.${country}`,
                    amount,
                  ])
              ),
              $set: {
                ...Object.fromEntries(
                  [...taxByCountry]
                    .filter(([, amount]) => amount > 0)
                    .map(([country]) => [`federalTaxArrearsLastTurnByCountry.${country}`, turn])
                ),
                updatedAt: now,
              },
            },
            note: "Record tax amounts due when current operating cash cannot fund withholding",
          },
        ],
        event: {
          kind: "monetary.executed",
          command: "turn.corporation.taxArrears",
          subjectType: "corporation",
          subjectId: snapshot.corpId.toString(),
          amount: 0,
          meta: {
            federalTaxArrearsAnchor: taxAnchor,
            sourceCurrency,
            operatingCashQuote: JSON.stringify(quote),
          },
        },
      };
      const recorded = await settleTransition(db, arrears);
      if (recorded.status !== "applied" && recorded.status !== "replayed") {
        throw new Error(recorded.error ?? `Corporate tax arrears ${arrearsKey} is incomplete`);
      }
      existingKeys.add(arrearsKey);
    };
    if (existingKeys.has(taxKey)) {
      const resumed = await treasuryLock.run(destinationKeys, () => resumeSettlement(db, taxKey));
      if (resumed.status === "rejected") {
        await recordTaxArrears();
        return;
      }
      if (resumed.status !== "applied" && resumed.status !== "replayed") {
        throw new Error(resumed.error ?? `Corporate tax receipt ${taxKey} is incomplete`);
      }
      return;
    }

    const sourceValuation = { currencyCode: sourceCurrency, localPerAnchor: sourceRate };
    const taxLegs: BankingTransition["legs"] = [
      {
        kind: "debit",
        amount: taxSourceLocal,
        valuation: sourceValuation,
        collection: "corporations",
        filter: { _id: oid(snapshot.corpId.toString()), liquidCapital: { $gte: taxSourceLocal } },
        path: "liquidCapital",
        note: "Withhold corporate tax from available realized operating cash",
      },
    ];
    for (const destination of taxDestinations) {
      const {
        country,
        amountAnchor,
        currencyCode: treasuryCurrency,
        localPerAnchor: treasuryRate,
      } = destination;
      const treasuryLocal = amountAnchor * treasuryRate;
      const treasuryValuation = { currencyCode: treasuryCurrency, localPerAnchor: treasuryRate };
      taxLegs.push({
        kind: "credit",
        amount: treasuryLocal,
        valuation: treasuryValuation,
        collection: "federalBudget",
        filter: treasuryFilter(country),
        path: "treasuryCashLocal",
        // The signed fiscal-position total moves in the same write as the cash,
        // under the leg's own receipt, instead of a second guarded projection
        // (seven more round trips per tax payment) to the same document.
        inc: { treasuryBalance: treasuryLocal },
        note: "Deliver the payer-funded tax into spendable Treasury cash and fiscal position",
      });
    }
    const taxTransition: BankingTransition = {
      key: taxKey,
      kind: "corporate_tax_withholding",
      turn,
      currency: sourceCurrency as CurrencyCode,
      legs: taxLegs,
      projections: [],
      event: {
        kind: "monetary.executed",
        command: "turn.corporation.taxWithholding",
        subjectType: "corporation",
        subjectId: snapshot.corpId.toString(),
        amount: taxSourceLocal,
        meta: {
          federalTaxAnchor: taxAnchor,
          sourceCurrency,
          sourceLocalPerAnchor: sourceRate,
          operatingCashQuote: JSON.stringify(quote),
        },
      },
    };
    const taxed = await treasuryLock.run(destinationKeys, () =>
      settleTransition(db, taxTransition)
    );
    if (taxed.status === "rejected") {
      // Withholding that the corporation cannot fund is a payable, not a
      // Treasury receipt. Persist it once and let the ordinary insolvency path
      // see the shortfall; never mint the missing government cash.
      await recordTaxArrears();
      return;
    }
    if (taxed.status !== "applied" && taxed.status !== "replayed") {
      throw new Error(taxed.error ?? `Corporate tax receipt ${taxKey} is incomplete`);
    }
  };

  // A corporation's receipts stay strictly ordered (gross, prior arrears,
  // loss, tax), and a corporation listed twice settles its entries in input
  // order inside one task, so its idempotency keys never race themselves.
  const snapshotsByCorp = new Map<string, CorpSnapshot[]>();
  for (const snapshot of snapshots) {
    const id = snapshot.corpId.toString();
    const group = snapshotsByCorp.get(id);
    if (group) group.push(snapshot);
    else snapshotsByCorp.set(id, [snapshot]);
  }
  const groups = interleaveByKey([...snapshotsByCorp.values()], (group) =>
    group
      .flatMap((snapshot) => Array.from(snapshot.federalTaxByCountryAnchor?.keys() ?? []))
      .sort()
      .join(",")
  );
  await runInLanes(groups, lanes, async (group) => {
    for (const snapshot of group) await settleSnapshot(snapshot);
  });
}
