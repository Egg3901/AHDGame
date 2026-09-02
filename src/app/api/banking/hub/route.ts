import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { withNoStore } from "@/lib/api/withNoStore";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { COUNTRY_CONFIGS, getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_CURRENCY_MAP,
  getCountryIdForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { currencyCentralBankUrl } from "@/lib/urls";
import { getBankId } from "@/lib/centralBank/helpers";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { getEffectiveBankRates } from "@/lib/banking/rates";
import { getCashReserves } from "@/lib/banking/bankCash";
import { getLendableHeadroom, getReserveRequirement } from "@/lib/banking/reserves";
import {
  averageCorpIncomePerTurn,
  characterIncomeInLoanCurrency,
  listBorrowerFacingLoans,
} from "@/lib/banking/lending";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { getGameState } from "@/lib/gameState";
import { loadCountryNameOverrides } from "@/lib/country/countryIdentity";
import { corporationPathIdFromDoc } from "@/lib/api/corporations/resolveQuery";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { Corporation, GameConfig } from "@/lib/db/types";
import type { Character } from "@/lib/db/types";
import type { BankCharterType } from "@/lib/db/types/bank";
import { savingsApyPercent } from "@/lib/currency/savingsInterest";
import type { ObjectId } from "mongodb";

// GET /api/banking/hub - World banking hub payload (CBs, private banks, savings, loans).
// Auth: requireAuth
// Errors: 401

type HubCentralBank = {
  currency: CurrencyCode;
  bankName: string;
  countryId: CountryId;
  countryName: string;
  href: string;
  primeRate: number;
  savingsApyPercent: number;
  isPrimary: boolean;
};

type HubPrivateBank = {
  corporationId: string;
  sequentialId: number | null;
  name: string;
  countryId: CountryId;
  countryName: string;
  currency: CurrencyCode;
  operatorType: "player" | "npp";
  charterType: BankCharterType;
  depositRatePercent: number;
  lendingRatePercent: number;
  warningBand: "green" | "amber" | "red" | null;
  confidence: number | null;
  totalDeposits: number;
  cashReserves: number;
  lendableHeadroom: number;
  href: string;
};

type SavingsOption = {
  holder: "centralBank" | string;
  label: string;
  depositRatePercent: number;
};

type HubSavingsRow = {
  currency: CurrencyCode;
  balance: number;
  currentHolder: "centralBank" | string;
  options: SavingsOption[];
};

async function handleGET() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const [config, registered, gameState, banks] = await Promise.all([
      db.collection<GameConfig>("gameConfig").findOne(
        { _id: "default" },
        {
          projection: {
            privateBankingEnabled: 1,
            bankPropTradingEnabled: 1,
            bankContagionEnabled: 1,
          },
        }
      ),
      getRegisteredCountryIds(db),
      getGameState(db),
      db
        .collection<CentralBank>("centralBanks")
        .find({})
        .project({
          _id: 1,
          countryId: 1,
          name: 1,
          primeRate: 1,
          currentInflation: 1,
          intorgId: 1,
        })
        .toArray(),
    ]);

    // Runtime renames, so the hub does not list a country under the name of a
    // state that has since been absorbed.
    const nameOverrides = await loadCountryNameOverrides(db);
    const countryName = (id: CountryId) =>
      nameOverrides[id] ?? getCountryDisplayName(id, gameState?.preset);

    const privateEnabled = await isPrivateBankingEnabled(config);
    const character = auth.user.character as Character | null | undefined;
    const primaryCountryId = (character?.countryId ?? "US") as CountryId;
    const primaryCurrency = COUNTRY_CURRENCY_MAP[primaryCountryId] ?? "USD";

    // One hub row per unique currency that a registered country uses.
    const currencies = new Set<CurrencyCode>();
    for (const id of registered) {
      const code = COUNTRY_CURRENCY_MAP[id];
      if (code) currencies.add(code);
    }

    const bankById = new Map(banks.map((b) => [String(b._id), b]));
    const centralBanks: HubCentralBank[] = [];
    for (const currency of [...currencies].sort()) {
      const anchor = getCountryIdForCurrency(currency);
      if (
        !registered.includes(anchor) &&
        !registered.some((id) => COUNTRY_CURRENCY_MAP[id] === currency)
      ) {
        continue;
      }
      const bankId = getBankId(anchor);
      const bank = bankById.get(bankId);
      const configRow = COUNTRY_CONFIGS[anchor];
      if (!configRow) continue;
      const prime =
        typeof bank?.primeRate === "number" && Number.isFinite(bank.primeRate) ? bank.primeRate : 0;
      const inflation =
        typeof bank?.currentInflation === "number" && Number.isFinite(bank.currentInflation)
          ? bank.currentInflation
          : 0;
      centralBanks.push({
        currency,
        bankName: bank?.name ?? configRow.centralBank.name,
        countryId: anchor,
        countryName: countryName(anchor),
        href: currencyCentralBankUrl(currency),
        primeRate: prime,
        savingsApyPercent: savingsApyPercent(prime, inflation),
        isPrimary: currency === primaryCurrency,
      });
    }
    centralBanks.sort(
      (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.bankName.localeCompare(b.bankName)
    );

    let privateBanks: HubPrivateBank[] = [];
    const savings: HubSavingsRow[] = [];
    let personalIncomeByCurrency: Partial<Record<CurrencyCode, number>> = {};
    let ceoCorporations: Array<{
      id: string;
      name: string;
      liquidCapital: number;
      incomePerTurn: number;
      currency: CurrencyCode;
    }> = [];
    let loans: Awaited<ReturnType<typeof listBorrowerFacingLoans>> = [];
    const personalCash: Partial<Record<CurrencyCode, number>> = {
      ...(character?.currencyBalances?.personal ?? {}),
    };
    const isAdmin = auth.user.isAdmin === true;

    // Always load active charters for the private-bank table (flag on) and for
    // admin unwind (flag off is a freeze; admins still need the escape hatch).
    if (privateEnabled || isAdmin) {
      type CharteredCorp = Pick<
        Corporation,
        "_id" | "sequentialId" | "name" | "countryId" | "ceoType" | "bankCharter"
      >;
      const chartered = (await db
        .collection<Corporation>("corporations")
        .find({ "bankCharter.status": "active" })
        .project({
          _id: 1,
          sequentialId: 1,
          name: 1,
          countryId: 1,
          ceoType: 1,
          bankCharter: 1,
        })
        .toArray()) as CharteredCorp[];

      const reserveByCurrency = new Map<CurrencyCode, number>();
      privateBanks = await Promise.all(
        chartered.map(async (corp) => {
          const charter = corp.bankCharter!;
          const rates = await getEffectiveBankRates(db, charter);
          const countryId = (corp.countryId ??
            getCountryIdForCurrency(charter.currency)) as CountryId;
          let reserveRatio = reserveByCurrency.get(charter.currency);
          if (reserveRatio === undefined) {
            reserveRatio = await getReserveRequirement(db, charter.currency);
            reserveByCurrency.set(charter.currency, reserveRatio);
          }
          return {
            corporationId: corp._id.toString(),
            sequentialId: corp.sequentialId ?? null,
            name: corp.name,
            countryId,
            countryName: countryName(countryId),
            currency: charter.currency,
            operatorType: corp.ceoType === "npp" ? "npp" : "player",
            charterType: charter.type,
            depositRatePercent: rates.depositRatePercent,
            lendingRatePercent: rates.lendingRatePercent,
            warningBand: charter.warningBand ?? null,
            confidence: typeof charter.confidence === "number" ? charter.confidence : null,
            totalDeposits: charter.totalDeposits ?? 0,
            cashReserves: getCashReserves(charter),
            lendableHeadroom: getLendableHeadroom(charter, reserveRatio),
            href: `/corporation/${corporationPathIdFromDoc({
              _id: corp._id as ObjectId,
              sequentialId: corp.sequentialId,
            })}?tab=bank`,
          };
        })
      );
      privateBanks.sort(
        (a, b) =>
          Number(a.operatorType === "npp") - Number(b.operatorType === "npp") ||
          a.name.localeCompare(b.name)
      );
    }

    if (privateEnabled && character) {
      const balances = character.currencyBalances?.savings ?? {};
      const holders = character.currencyBalances?.savingsHolder ?? {};
      const depositTakers = privateBanks.filter(
        (b) => b.charterType === "retail" || b.charterType === "universal"
      );

      for (const cb of centralBanks) {
        const balance = balances[cb.currency] ?? 0;
        const currentHolder = (holders[cb.currency] ?? "centralBank") as "centralBank" | string;
        if (balance <= 0 && currentHolder === "centralBank") {
          // Still list currencies the player might open; keep rows with any activity or primary.
          if (cb.currency !== primaryCurrency) continue;
        }
        const options: SavingsOption[] = [
          {
            holder: "centralBank",
            label: `${cb.bankName} (central bank)`,
            depositRatePercent: cb.savingsApyPercent,
          },
          ...depositTakers
            .filter((b) => b.currency === cb.currency)
            .map((b) => ({
              holder: b.corporationId,
              label: b.name,
              depositRatePercent: b.depositRatePercent,
            })),
        ];
        savings.push({
          currency: cb.currency,
          balance,
          currentHolder,
          options,
        });
      }

      const owned = await db
        .collection<Corporation>("corporations")
        .find({ userId: character.userId })
        .project({
          _id: 1,
          name: 1,
          sequentialId: 1,
          liquidCapital: 1,
          liquidCurrencyCode: 1,
          countryId: 1,
        })
        .toArray();
      ceoCorporations = await Promise.all(
        owned.map(async (c) => ({
          id: c._id.toString(),
          name: c.name,
          liquidCapital: c.liquidCapital ?? 0,
          incomePerTurn: await averageCorpIncomePerTurn(db, c._id, gameState?.currentTurn ?? 1),
          currency: (resolveCorpLiquidCurrencyCode(c) ?? "USD") as CurrencyCode,
        }))
      );
      loans = await listBorrowerFacingLoans(db, {
        characterId: character._id,
        characterName: character.name ?? "You",
        corporations: owned.map((c) => ({ id: c._id, name: c.name })),
      });
      const lendingCurrencies = [
        ...new Set(
          privateBanks
            .filter((b) => b.charterType === "retail" || b.charterType === "universal")
            .map((b) => b.currency)
        ),
      ];
      personalIncomeByCurrency = Object.fromEntries(
        await Promise.all(
          lendingCurrencies.map(async (code) => [
            code,
            await characterIncomeInLoanCurrency(db, character, code),
          ])
        )
      ) as Partial<Record<CurrencyCode, number>>;
    }

    return NextResponse.json({
      privateBankingEnabled: privateEnabled,
      isAdmin,
      characterId: character?._id?.toString() ?? null,
      primaryCountryId,
      primaryCurrency,
      centralBanks,
      privateBanks,
      savings,
      personalCash,
      personalIncomeByCurrency,
      currentTurn: gameState?.currentTurn ?? 1,
      ceoCorporations,
      loans,
      lendingBanks: privateBanks.filter(
        (b) => b.charterType === "retail" || b.charterType === "universal"
      ),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export const GET = withNoStore(handleGET);
