/** Actual bank-console charter and funding commands after the earlier supervised unwind. */
import assert from "node:assert/strict";
import type { Db } from "mongodb";
import type { Page } from "playwright";
import { BANK, advanceJourney, journeySnapshot } from "./bankingJourneyFixture";

export async function runCharterJourney(page: Page, db: Db, base: string) {
  page.setDefaultTimeout(180_000);
  const before = await journeySnapshot(db);
  assert.equal(
    before.bank.status,
    "revoked",
    "Continue the real supervised unwind, without manufacturing a new charter"
  );
  const treasuryBefore = Number(
    (await db.collection("corporations").findOne({ _id: BANK }))?.liquidCapital
  );
  await page.goto(`${base}/corporation/132811?tab=bank`, {
    waitUntil: "domcontentloaded",
    timeout: 300_000,
  });
  await page
    .getByRole("heading", { name: "Issue bank charter", exact: true })
    .waitFor({ timeout: 300_000 });
  const explanation = await page
    .getByRole("heading", { name: "Issue bank charter", exact: true })
    .locator("..")
    .innerText();
  assert(explanation.includes("corporation treasury"));
  await page.getByLabel("Charter type").selectOption("retail");
  const issuedResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith("/bank/charter") && r.request().method() === "POST",
    { timeout: 180_000 }
  );
  await page.getByRole("button", { name: "Issue charter", exact: true }).click();
  const issued = await issuedResponse;
  const issueResult = await issued.json();
  assert(issued.ok(), JSON.stringify(issueResult));
  const chartered = await journeySnapshot(db);
  const treasuryAfter = Number(
    (await db.collection("corporations").findOne({ _id: BANK }))?.liquidCapital
  );
  assert.equal(chartered.bank.status, "active");
  assert(issueResult.postedCapital > 0);
  assert(Math.abs(treasuryBefore - treasuryAfter - issueResult.postedCapital) < 0.02);
  assert(Math.abs(chartered.bank.cash - issueResult.postedCapital) < 0.02);
  assert(Math.abs(chartered.cash - before.cash) < 0.02);
  const capitalJournal = chartered.journals.filter((move) => move.kind === "bank_charter_capital");
  assert.equal(capitalJournal.length, 1, "One actual charter capital settlement");
  assert.equal(capitalJournal[0].status, "applied");
  assert.deepEqual(
    capitalJournal[0].amounts.map((leg: { kind: string; amount: number }) => ({
      kind: leg.kind,
      amount: leg.amount,
    })),
    [
      { kind: "debit", amount: issueResult.postedCapital },
      { kind: "credit", amount: issueResult.postedCapital },
    ]
  );
  console.log("completed actual UI retail charter issuance");
  await page.getByRole("button", { name: "Treasury", exact: true }).click();
  await page.getByLabel("Capital transfer amount").fill("1000");
  const fundingExplanation = await page
    .getByRole("heading", { name: "Capital adequacy", exact: true })
    .locator("..")
    .innerText();
  assert(fundingExplanation.includes("stands behind the depositors"));
  const fundingResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith("/bank/recapitalize") && r.request().method() === "POST",
    { timeout: 180_000 }
  );
  await page.getByRole("button", { name: "Move into bank", exact: true }).click();
  const funding = await fundingResponse;
  assert(funding.ok(), await funding.text());
  const funded = await journeySnapshot(db);
  const treasuryFunded = Number(
    (await db.collection("corporations").findOne({ _id: BANK }))?.liquidCapital
  );
  assert(Math.abs(funded.bank.cash - chartered.bank.cash - 1000) < 0.02);
  assert(Math.abs(treasuryAfter - treasuryFunded - 1000) < 0.02);
  assert(Math.abs(funded.cash - chartered.cash) < 0.02);
  const game = await db.collection("gameState").findOne({ _id: "current" as never });
  assert(game);
  const phases = await advanceJourney(db, game.currentTurn + 1, game.currentYear);
  const afterTurn = await journeySnapshot(db);
  assert.equal(afterTurn.bank.status, "active");
  assert(afterTurn.journals.every((journal) => journal.status === "applied"));
  assert(
    Math.abs(
      afterTurn.cash - funded.cash - (afterTurn.mint - funded.mint) + (afterTurn.burn - funded.burn)
    ) < 0.02
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 300_000 });
  const response = await page.request.get(`${base}/api/banking/corporation/${BANK.toHexString()}`);
  assert(response.ok());
  const readModel = await response.json();
  assert.equal(readModel.charter.cashReserves, afterTurn.bank.cash);
  assert.equal(readModel.charter.status, "active");
  console.log("completed actual UI bank funding and subsequent turn/read model");
  return {
    explanation,
    fundingExplanation,
    treasuryBefore,
    treasuryAfter,
    treasuryFunded,
    postedCapital: issueResult.postedCapital,
    before,
    chartered,
    funded,
    afterTurn,
    phases,
    readModel: { cashReserves: readModel.charter.cashReserves, status: readModel.charter.status },
  };
}
