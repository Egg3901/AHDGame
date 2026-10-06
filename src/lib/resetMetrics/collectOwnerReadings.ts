/**
 * First live owners for the v2 board. Legacy macro readings are underlying
 * economic inputs, not a second set of player-facing primary metrics.
 */
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import {
  openingGrossPurchasingInputs1991,
  openingLifeCalibration1991,
  openingHealthProxyReferences1991,
} from "./openingSeed1991";
import { liveHealthProxies } from "./rules/liveHealthProxies";
import { fiscalOwnerReadings } from "./rules/fiscalOwner";
import { nationalForceReadiness } from "./rules/forceReadiness";
import { provisionalRealPurchasingPower } from "./rules/realPurchasingPower";
import { dueResetMetricIds } from "./rules/refresh";
import type { ResetMetricSnapshot } from "./rules/snapshot";
import type { MetricOwnerTurnReadingsByBoard } from "./refreshTurn";

let openingCalibrationCache: {
  gross: ReturnType<typeof openingGrossPurchasingInputs1991>;
  life: ReturnType<typeof openingLifeCalibration1991>;
  health: ReturnType<typeof openingHealthProxyReferences1991>;
} | null = null;

function openingCalibration() {
  return (openingCalibrationCache ??= {
    gross: openingGrossPurchasingInputs1991(),
    life: openingLifeCalibration1991(),
    health: openingHealthProxyReferences1991(),
  });
}

const DIRECT_ECONOMIC_OWNERS = [
  ["01", "unemploymentRate"],
  ["03", "povertyRate"],
  ["05", "gdpGrowth"],
  ["06", "productivityGrowth"],
  ["08", "tradeBalance"],
] as const;

const FAIL_CLOSED_OWNER_IDS = new Set([
  "01",
  "03",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "16",
  "18",
  "20",
  "54",
  "55",
  "56",
  "57",
]);

export async function collectResetMetricOwnerReadings(
  db: Db,
  boards: readonly ResetMetricSnapshot[],
  turn: number
): Promise<MetricOwnerTurnReadingsByBoard> {
  const { gross: openingGross, life: openingLife, health: openingHealth } = openingCalibration();
  const regionalIds = boards
    .filter((board) => board.scope === "regional")
    .map((board) => board.regionId!);
  const countryIds = [...new Set(boards.map((board) => board.countryId))];
  const readinessDue = boards.some(
    (board) =>
      board.scope === "national" && dueResetMetricIds(board, turn, false, false).includes("57")
  );
  const healthDue = boards.some(
    (board) =>
      board.scope === "regional" &&
      dueResetMetricIds(board, turn, true, false).some((id) => id === "16" || id === "18")
  );
  const [macro, budgets, units, healthStocks] = await Promise.all([
    db
      .collection<MacroMetricsDoc>("macroMetrics")
      .find(
        { _id: { $in: regionalIds } },
        {
          projection: {
            _id: 1,
            countryId: 1,
            "economic.medianIncome.value": 1,
            "economic.costOfLiving.value": 1,
            "economic.unemploymentRate.value": 1,
            "economic.povertyRate.value": 1,
            "economic.gdpGrowth.value": 1,
            "economic.productivityGrowth.value": 1,
            "economic.tradeBalance.value": 1,
            resetCohortReading: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .find(
        { countryId: { $in: countryIds } },
        {
          projection: {
            countryId: 1,
            gdp: 1,
            "revenue.total": 1,
            "spending.total": 1,
            "economicFactors.inflationRate": 1,
            "debt.principal": 1,
          },
        }
      )
      .toArray(),
    readinessDue
      ? db
          .collection<MilitaryUnit>("militaryUnits")
          .find(
            { countryId: { $in: countryIds } },
            {
              projection: {
                countryId: 1,
                basePower: 1,
                readiness: 1,
                integrity: 1,
                supply: 1,
                readyAtTurn: 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([]),
    healthDue
      ? db
          .collection<StateMetrics>("stateMetrics")
          .find(
            { _id: { $in: regionalIds } },
            {
              projection: {
                _id: 1,
                countryId: 1,
                "healthcare.uninsuredRate.value": 1,
                "healthcare.physicianRate.value": 1,
                "healthcare.publicHealthPreparedness.value": 1,
                "healthcare.nhsWaitingTime.value": 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([]),
  ]);
  const macroById = new Map(macro.map((row) => [String(row._id), row]));
  const budgetByCountry = new Map(budgets.map((row) => [row.countryId, row]));
  const healthById = new Map(healthStocks.map((row) => [String(row._id), row]));
  const unitsByCountry = new Map(
    countryIds.map((countryId) => [countryId, units.filter((unit) => unit.countryId === countryId)])
  );
  return Object.fromEntries(
    boards.map((board) => {
      // The demographic phase runs each turn. A missing current-turn receipt
      // must leave the cohort observation due, not silently defer it forever.
      const cohortDue = board.scope === "regional";
      const dueIds = dueResetMetricIds(board, turn, cohortDue, false);
      const due = new Set(dueIds);
      const updates: Record<string, ResetMetricSnapshot["observations"][string]> = {};
      if (board.scope === "national") {
        const budget = budgetByCountry.get(board.countryId);
        const fiscal = fiscalOwnerReadings({
          gdp: budget?.gdp,
          revenue: budget?.revenue?.total,
          spending: budget?.spending?.total,
          debtPrincipal: budget?.debt?.principal,
          inflationRate: budget?.economicFactors?.inflationRate,
        });
        if (due.has("07") && fiscal.priceChange !== null) {
          updates["07"] = {
            ...board.observations["07"]!,
            value: fiscal.priceChange,
            status: "derived",
            source: "current federal budget price process",
            note: "Annual CPI change from the live price process, not a 0-100 score.",
          };
        }
        if (due.has("09") && fiscal.balanceToGdp !== null) {
          updates["09"] = {
            ...board.observations["09"]!,
            value: fiscal.balanceToGdp,
            status: "derived",
            source: "current national revenue less spending and GDP",
            note: "Annual budget balance as a share of current GDP.",
          };
        }
        if (due.has("10") && fiscal.debtToGdp !== null) {
          updates["10"] = {
            ...board.observations["10"]!,
            value: fiscal.debtToGdp,
            status: "derived",
            source: "current sovereign principal and GDP",
            note: "Outstanding sovereign principal as a share of current GDP.",
          };
        }
        if (due.has("57")) {
          const readiness = nationalForceReadiness(unitsByCountry.get(board.countryId) ?? [], turn);
          if (readiness !== null) {
            updates["57"] = {
              ...board.observations["57"]!,
              value: readiness,
              status: "derived",
              source: "current national military roster",
              note: "Power-weighted readiness after condition, supply, and operational-date checks.",
            };
          }
        }
      } else {
        const healthRow = healthById.get(board.regionId!);
        const health = healthRow?.countryId === board.countryId ? healthRow.healthcare : undefined;
        const reference = openingHealth[board.countryId as keyof typeof openingHealth];
        const physicianReference = reference?.physicianRate ?? health?.physicianRate?.value ?? null;
        const preparednessReference =
          reference?.preparedness ?? health?.publicHealthPreparedness?.value ?? null;
        const access = liveHealthProxies({
          countryId: board.countryId,
          physicianRate: health?.physicianRate?.value ?? null,
          preparedness: health?.publicHealthPreparedness?.value ?? null,
          uninsuredPercent: health?.uninsuredRate?.value ?? null,
          openingPhysicianReference: physicianReference ?? Number.NaN,
          openingPreparednessReference: preparednessReference ?? Number.NaN,
        });
        if (due.has("16") && access) {
          updates["16"] = {
            ...board.observations["16"]!,
            value: access.effectiveCoverage,
            status: "proxy",
            source: "current eligibility and physician/preparedness service-reach estimate",
            note: "Game-calibrated reachable-care estimate using fixed 1991 reference stocks, not observed patient access.",
          };
        }
        const delay =
          board.countryId === "UK"
            ? health?.nhsWaitingTime?.value
            : board.countryId === "IE"
              ? health?.hseWaitingListMonths?.value
              : access?.treatmentDelayIndex;
        if (due.has("18") && typeof delay === "number" && Number.isFinite(delay) && delay >= 0) {
          updates["18"] = {
            ...board.observations["18"]!,
            value: delay,
            status: "proxy",
            source:
              board.countryId === "UK" || board.countryId === "IE"
                ? "current national health-service waiting index"
                : "current physician/preparedness delay estimate",
            note: "Comparable treatment-delay proxy, not median waiting days. Fixed opening references preserve nationwide capacity changes.",
          };
        }
        const candidateMacro = macroById.get(board.regionId!);
        const liveMacro =
          candidateMacro?.countryId === board.countryId ? candidateMacro : undefined;
        for (const [id, field] of DIRECT_ECONOMIC_OWNERS) {
          if (!due.has(id)) continue;
          const value = liveMacro?.economic?.[field]?.value;
          if (typeof value !== "number" || !Number.isFinite(value)) continue;
          updates[id] = {
            ...board.observations[id]!,
            value,
            status: "derived",
            source: `current regional economy engine: ${field}`,
            note: "Current model result, not a political-board score or an independently measured statistic.",
          };
        }
        if (due.has("02")) {
          const current = liveMacro;
          const opening =
            openingGross[board.countryId as keyof typeof openingGross]?.[board.regionId!];
          const income = current?.economic?.medianIncome?.value;
          const basket = current?.economic?.costOfLiving?.value;
          if (opening && typeof income === "number" && typeof basket === "number") {
            try {
              updates["02"] = {
                ...board.observations["02"]!,
                value: provisionalRealPurchasingPower({
                  currentGrossIncome: income,
                  currentBasketIndex: basket,
                }),
                status: "proxy",
                source: "game-calibrated gross household income and consumer basket",
                note: "Annual real household income in local currency at constant 1991 prices. Taxes and transfers are not yet included.",
              };
            } catch {
              // The missing due reading is surfaced by the persistence shell.
            }
          }
        }
        const cohort = liveMacro?.resetCohortReading;
        if (cohort?.asOfTurn === turn) {
          const lifeCalibration =
            openingLife[board.countryId as keyof typeof openingLife]?.[board.regionId!];
          const measures = [
            [
              "20",
              typeof cohort.periodLifeExpectancy === "number" && lifeCalibration
                ? lifeCalibration.openingYears +
                  cohort.periodLifeExpectancy -
                  lifeCalibration.modeledYears
                : null,
              "Period life expectancy from this turn's age-specific mortality curve, calibrated to the 1991 opening regional anchor.",
            ],
            [
              "54",
              cohort.populationGrowthAnnualized,
              "Annualized population change from this turn's realized births, deaths, and migration.",
            ],
            [
              "55",
              cohort.realizedTfr,
              "Realized fertility from births and the female age distribution, including service constraints.",
            ],
            [
              "56",
              cohort.dependencyBurden15To64,
              "Residents under 15 and 65 or older per 100 residents aged 15-64.",
            ],
          ] as const;
          for (const [id, value, note] of measures) {
            if (!due.has(id) || typeof value !== "number" || !Number.isFinite(value)) continue;
            updates[id] = {
              ...board.observations[id]!,
              value,
              status: "derived",
              source: "current single-year age and sex cohort flow",
              note,
            };
          }
        }
      }
      // Several v2 outcomes do not yet have a more granular physical ledger in
      // the game. They retain their last owned value instead of reading the
      // retired v1 political score. This is deliberately labelled as a
      // game-calibrated continuity estimate so the UI never presents it as a
      // fresh measurement. Owners with live ledgers above remain fail-closed.
      for (const id of dueIds) {
        if (updates[id] || FAIL_CLOSED_OWNER_IDS.has(id)) continue;
        const prior = board.observations[id];
        if (typeof prior?.value !== "number" || !Number.isFinite(prior.value)) continue;
        updates[id] = {
          ...prior,
          status: "proxy",
          source: `provisional continuity owner: ${prior.owner}`,
          note: "Game-calibrated carry-forward until this owner has a physical live ledger. Laws and actions affect underlying systems where implemented; this estimate does not invent a direct bonus.",
        };
      }
      return [board._id, { updates, cohortDue, electionDue: false }];
    })
  );
}
