/**
 * Bounded deterministic qualification for minister actions and account coverage.
 * Uses checked-in 1991 opening data, never a configured database. This is an
 * action-lane simulation and one-turn settlement replay, not a world simulation.
 * Run: npx tsx scripts/sim/ministerActionsV2Qualification.ts --out <report.json>
 */
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { BSON } from "mongodb";
import { getCabinetPositions } from "../../src/lib/constants/cabinetMechanics";
import { COUNTRY_CONFIGS } from "../../src/lib/constants/countries";
import { isSeatActive } from "../../src/lib/cabinet/rosterEra";
import { DEPARTMENT_DEFINITIONS } from "../../src/lib/governmentFinance/departmentCatalog";
import { includedAuthorityPerTurn } from "../../src/lib/governmentFinance/rules/appropriation";
import { buildOpeningDepartmentBoards1991 } from "../../src/lib/resetFinance/openingDepartmentBoards1991";
import { openingFiscalBooks1991 } from "../../src/lib/resetFinance/opening1991";
import { openingNamedGrantClaims1991 } from "../../src/lib/resetFinance/openingOwnership1991";
import { buildOpeningDepartmentFundingPartition } from "../../src/lib/resetFinance/rules/liveDepartmentAccount";
import { settleLiveDepartmentTurn } from "../../src/lib/resetFinance/rules/liveDepartmentTurn";
import { resetActionsForSeat } from "../../src/lib/resetCabinet/catalog";
import {
  useCabinetAction as activateCabinetAction,
  combineActiveActionEffects,
  type ActiveCabinetAction,
  type ActionUseHistory,
  type CabinetActorActionState,
} from "../../src/lib/resetCabinet/rules/actions";

const out = process.argv[process.argv.indexOf("--out") + 1];
if (!process.argv.includes("--out") || !out)
  throw new Error("Supply --out outside the source tree");
const countries = ["US", "UK", "JP", "IE"] as const;
const books = openingFiscalBooks1991();
const partition = buildOpeningDepartmentFundingPartition(
  buildOpeningDepartmentBoards1991("qualification", 1),
  DEPARTMENT_DEFINITIONS,
  Object.fromEntries(countries.map((country) => [country, books[country].grants])),
  openingNamedGrantClaims1991()
);
// The former seed produced precisely the accounts with national law families.
const baseline = partition.accounts.filter(
  (account) => Object.keys(account.familyAnnualDemand).length > 0
);
const additions = partition.accounts.filter((account) => !baseline.includes(account));
assert(additions.every((account) => account.balance === 0 && account.annualAuthority === 0));
const totalCash = (rows: typeof baseline) => rows.reduce((sum, row) => sum + row.balance, 0);
assert.equal(totalCash(baseline), totalCash(partition.accounts));
// Extra zero-claim accounts must not change any old account's first settlement.
const replay = (accounts: typeof baseline) =>
  accounts.map(
    (account) =>
      settleLiveDepartmentTurn({
        account,
        turn: 2,
        authorityPaid: account.externallySettled
          ? 0
          : Object.values(account.familyAnnualDemand).reduce(
              (sum, annual) => sum + includedAuthorityPerTurn(annual, 2),
              0
            ),
      }).next
  );
const oldReplay = replay(baseline);
const candidateReplay = replay(partition.accounts);
for (const old of oldReplay)
  assert.deepEqual(
    candidateReplay.find((row) => row._id === old._id),
    old
  );
assert.equal(totalCash(oldReplay), totalCash(candidateReplay));

const results = countries.map((country) => {
  const seats = getCabinetPositions(country).filter((seat) =>
    isSeatActive(
      seat,
      1991,
      new Set(country === COUNTRY_CONFIGS.US.id ? ["secretary_of_education"] : [])
    )
  );
  let active: ActiveCabinetAction[] = [];
  let history: ActionUseHistory[] = [];
  const actors: Record<string, CabinetActorActionState> = {};
  const uses: Record<string, number> = {};
  const actionUses: Record<string, number> = {};
  let maxCombinedStrength = 0;
  for (let turn = 1; turn <= 120; turn++) {
    for (const seat of seats) {
      const own = partition.accounts.filter(
        (account) => account.countryId === country && account.controllingSeatId === seat.id
      );
      assert(own.length > 0, `${country}:${seat.id} account missing`);
      const staff = resetActionsForSeat(country, seat.id).filter(
        (action) => action.costClass === "Staff"
      );
      assert(staff.length >= 2, `${country}:${seat.id} needs two Staff choices`);
      assert(new Set(staff.map((action) => action.target)).size >= 2);
      // Rotate the preferred choice, trying alternatives when a target is on
      // cooldown. Office concurrency and the shared pool still apply.
      const preferred = (uses[seat.id] ?? 0) % staff.length;
      for (let offset = 0; offset < staff.length; offset++) {
        const action = staff[(preferred + offset) % staff.length]!;
        const used = activateCabinetAction({
          action,
          turn,
          actor: actors[seat.id] ?? { charges: 4, lastRechargeTurn: 1 },
          seatActive: true,
          legalAuthority: true,
          capacityAvailable: true,
          annualNationalGdp: 1_000_000_000,
          flexibleOperatingFunds: 0,
          active,
          history,
        });
        actors[seat.id] = used.actor;
        assert(used.actor.charges >= 0 && used.actor.charges <= 4);
        assert.equal(used.operatingDebit, 0);
        if (used.allowed) {
          active = [...used.active];
          history = [...used.history];
          uses[seat.id] = (uses[seat.id] ?? 0) + 1;
          actionUses[action.id] = (actionUses[action.id] ?? 0) + 1;
          break;
        }
      }
    }
    for (const effect of combineActiveActionEffects(active, turn)) {
      assert(effect.favorableNormalizedPoints <= 0.2);
      maxCombinedStrength = Math.max(maxCombinedStrength, effect.favorableNormalizedPoints);
    }
  }
  assert(
    seats.every((seat) => (uses[seat.id] ?? 0) >= 2),
    "Every minister must complete multiple action/cooldown cycles"
  );
  for (const seat of seats) {
    const staff = resetActionsForSeat(country, seat.id).filter(
      (action) => action.costClass === "Staff"
    );
    assert(
      staff.every((action) => (actionUses[action.id] ?? 0) >= 2),
      `${country}:${seat.id} must exercise both choices repeatedly`
    );
  }
  return { country, offices: seats.length, officeUses: uses, actionUses, maxCombinedStrength };
});
const bsonBytes = (rows: typeof baseline) =>
  rows.reduce((sum, row) => sum + BSON.serialize(row).length, 0);
const diff = execFileSync(
  "git",
  ["diff", "HEAD", "--", "src", "scripts/sim/ministerActionsV2Qualification.ts"],
  { encoding: "utf8" }
);
const report = {
  verdict: "passed",
  fixture: "checked-in 1991 opening; no database",
  horizonTurns: 120,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  trackedDiffSha256: createHash("sha256").update(diff).digest("hex"),
  scope:
    "Administrative action lane and one-turn department settlement equivalence; not an integrated world simulation",
  accountRead: {
    beforeDocuments: baseline.length,
    afterDocuments: partition.accounts.length,
    beforeBsonBytes: bsonBytes(baseline),
    afterBsonBytes: bsonBytes(partition.accounts),
    roundTrips: "Unchanged: one account roster read; document/byte values are fixture measurements",
  },
  addedAccounts: additions.length,
  createdCash: 0,
  changedExistingSettlementOutputs: 0,
  results,
};
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
