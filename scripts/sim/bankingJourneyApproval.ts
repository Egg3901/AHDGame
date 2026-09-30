/** CEO opt-in, pending request, actual approval and next-turn borrower outcome. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { Db } from "mongodb";
import type { Page } from "playwright";
import { BANK, BORROWER, advanceJourney, journeySnapshot } from "./bankingJourneyFixture";

export async function runApprovalJourney(
  page: Page,
  db: Db,
  base: string,
  resumedToggleSource?: string
) {
  page.setDefaultTimeout(120_000);
  const near = (actual: number, expected: number, label: string) =>
    assert(Math.abs(actual - expected) < 0.02, `${label}: ${actual} != ${expected}`);
  const command = async (path: string, action: () => Promise<unknown>) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === path && r.request().method() !== "GET",
        { timeout: 180_000 }
      ),
      action(),
    ]);
    const body = await response.json();
    assert(response.ok(), `${path}: ${JSON.stringify(body)}`);
    return body;
  };
  const before = await journeySnapshot(db);
  assert.equal(before.bank.status, "active");
  const initialIds = new Set(
    (
      await db
        .collection("bankLoans")
        .find({ borrowerType: "corporation", borrowerId: BORROWER })
        .toArray()
    ).map((loan) => loan._id.toHexString())
  );
  if (!page.url().startsWith(`${base}/corporation/132811`))
    await page.goto(`${base}/corporation/132811?tab=bank`, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });
  const rejectCookies = page.getByRole("button", { name: "Reject", exact: true });
  if (await rejectCookies.isVisible()) await rejectCookies.click();
  await page.getByRole("button", { name: /^Lending(?:\s*\d+)?$/ }).click();
  if (!resumedToggleSource)
    await command(`/api/corporations/${BANK.toHexString()}/bank/approval`, () =>
      page.getByRole("button", { name: "Auto-approve", exact: true }).click()
    );
  assert.equal(
    (await db.collection("corporations").findOne({ _id: BANK }))?.bankCharter.requireApproval,
    true
  );
  await page.getByRole("button", { name: "Approval required", exact: true }).waitFor();
  const toggleExplanation = await page
    .getByText("New loan requests wait for you to approve or decline them in the loan book.")
    .innerText();
  await page.goto(`${base}/banking`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page
    .getByRole("button", { name: "Apply for a loan at Journey Savings Bank", exact: true })
    .click();
  const pendingExplanation = await page
    .getByText(/This bank reviews requests manually/)
    .innerText();
  await page.getByRole("button", { name: "Corporation loan", exact: true }).click();
  await page.getByLabel("Borrowing corporation").selectOption(BORROWER.toHexString());
  await page.getByLabel("Loan principal").fill("10000");
  await page.getByLabel("Loan term in turns").fill("12");
  const requested = await command("/api/banking/loans", () =>
    page.getByRole("button", { name: "Submit loan request", exact: true }).click()
  );
  assert.equal(requested.pending, true);
  const pending = await db.collection("bankLoans").findOne({
    borrowerType: "corporation",
    borrowerId: BORROWER,
    status: "pending",
    principal: 10000,
  });
  assert(pending && !initialIds.has(pending._id.toHexString()));
  const queued = await journeySnapshot(db);
  near(queued.borrowerCash, before.borrowerCash, "pending request credits no borrower cash");
  near(queued.bank.cash, before.bank.cash, "pending request debits no vault cash");
  near(queued.cash, before.cash, "pending request conservation");
  writeFileSync(
    `${process.env.JOURNEY_SCREENSHOT_PREFIX}.approval.json`,
    JSON.stringify(
      { stage: "pending", before, queued, pendingId: pending._id.toHexString() },
      null,
      2
    )
  );
  await page.goto(`${base}/corporation/132811?tab=bank`, {
    waitUntil: "domcontentloaded",
    timeout: 180_000,
  });
  await page.getByRole("button", { name: /^Lending(?:\s*\d+)?$/ }).click();
  await command(
    `/api/corporations/${BANK.toHexString()}/bank/loans/${pending._id.toHexString()}/decision`,
    () => page.getByRole("button", { name: "Approve", exact: true }).click()
  );
  const acceptedLoan = await db.collection("bankLoans").findOne({ _id: pending._id });
  assert.equal(acceptedLoan?.status, "current");
  const accepted = await journeySnapshot(db);
  near(accepted.borrowerCash - queued.borrowerCash, 10000, "approved borrower credit");
  near(queued.bank.cash - accepted.bank.cash, 10000, "approved vault debit");
  near(accepted.cash, queued.cash, "approval cash conservation");
  assert(accepted.journals.every((move) => move.status === "applied"));
  writeFileSync(
    `${process.env.JOURNEY_SCREENSHOT_PREFIX}.approval.json`,
    JSON.stringify(
      { stage: "accepted", before, queued, accepted, pendingId: pending._id.toHexString() },
      null,
      2
    )
  );
  const game = await db.collection("gameState").findOne({ _id: "current" as never });
  assert(game);
  const phases = await advanceJourney(db, game.currentTurn + 1, game.currentYear);
  const afterTurn = await journeySnapshot(db);
  const serviced = await db.collection("bankLoans").findOne({ _id: pending._id });
  assert(serviced && serviced.outstanding < 10000 && serviced.outstanding > 0);
  near(
    afterTurn.cash - accepted.cash,
    afterTurn.mint - accepted.mint - (afterTurn.burn - accepted.burn),
    "approval turn conservation"
  );
  assert(afterTurn.journals.every((move) => move.status === "applied"));
  await page.goto(`${base}/banking`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.getByRole("tab", { name: "Your accounts", exact: true }).click();
  const response = await page.request.get(`${base}/api/banking/hub`);
  assert(response.ok());
  const readModel = await response.json();
  const visibleLoan = readModel.loans.find(
    (loan: { id: string }) => loan.id === pending._id.toHexString()
  );
  assert(visibleLoan);
  assert.equal(visibleLoan.outstanding, serviced.outstanding);
  assert.equal(readModel.currentTurn, game.currentTurn + 1);
  console.log("completed actual UI pending corporate loan, CEO approval and next-turn read model");
  const result = {
    resumedToggleSource,
    toggleExplanation,
    pendingExplanation,
    before,
    queued,
    accepted,
    afterTurn,
    phases,
    readModel: {
      currentTurn: readModel.currentTurn,
      principal: visibleLoan.principal,
      outstanding: visibleLoan.outstanding,
      status: visibleLoan.status,
    },
  };
  writeFileSync(
    `${process.env.JOURNEY_SCREENSHOT_PREFIX}.approval.json`,
    JSON.stringify({ stage: "complete", ...result }, null, 2)
  );
  return result;
}
