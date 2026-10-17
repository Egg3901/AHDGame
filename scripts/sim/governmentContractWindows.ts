/** Deterministic offline deadline qualification; redirect stdout outside source directories. */
import assert from "node:assert/strict";
import {
  tenderDeadlines,
  validDeadlines,
  tenderTab,
  canBid,
  canAward,
} from "../../src/lib/governmentContracts/rules";
let scenarios = 0;
for (let turn = 1; turn <= 48; turn++)
  for (let biddingTurns = 6; biddingTurns <= 48; biddingTurns++) {
    const dates = tenderDeadlines(turn, biddingTurns);
    const tender = { status: "open" as const, ...dates };
    assert(validDeadlines(turn, dates.closesTurn, dates.awardDeadlineTurn));
    assert(canBid(tender, dates.closesTurn - 1));
    assert(!canBid(tender, dates.closesTurn));
    assert(canAward(tender, dates.closesTurn));
    assert(canAward(tender, dates.awardDeadlineTurn - 1));
    assert(!canAward(tender, dates.awardDeadlineTurn));
    assert.equal(tenderTab(tender, dates.awardDeadlineTurn), "canceled");
    scenarios++;
  }
console.log(
  JSON.stringify(
    {
      scope: "offline rules qualification only, no database or world",
      scenarios,
      biddingTurns: { min: 6, default: 24, max: 48 },
      awardTurns: 24,
      checks: [
        "all starting turns in a game year",
        "all legal durations",
        "close and expiry boundaries",
        "quarter and year crossings",
      ],
    },
    null,
    2
  )
);
