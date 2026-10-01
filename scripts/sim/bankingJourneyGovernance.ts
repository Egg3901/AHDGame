/** Browser exercises real authority gates; appointments are explicit scenario inputs. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { Db } from "mongodb";
import type { Page } from "playwright";
import { SAVER } from "./bankingJourneyFixture";

export async function runGovernanceJourney(
  page: Page,
  db: Db,
  base: string,
  switchToIrishChair: () => Promise<void>
) {
  const beforeUs = await db.collection("centralBanks").findOne({ _id: "US" as never });
  assert(beforeUs?.activeFomcMeeting, "Actual committee turn must have opened a meeting");
  // This page loads its real session before requesting the committee. Await that
  // read explicitly instead of starting a button timeout while the shell loads.
  const meetingResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/country/us/fomc" && r.request().method() === "GET",
    { timeout: 180_000 }
  );
  const [meetingRead] = await Promise.all([
    meetingResponse,
    page.goto(`${base}/centralbank/usd?tab=committee`, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    }),
  ]);
  assert(meetingRead.ok(), "Actual committee read must succeed before voting");
  const rejectCookies = page.getByRole("button", { name: "Reject", exact: true });
  if (await rejectCookies.isVisible()) await rejectCookies.click();
  const voteResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/country/us/fomc/vote" && r.request().method() === "POST",
    { timeout: 180_000 }
  );
  const [vote] = await Promise.all([
    voteResponse,
    page.getByRole("button", { name: "Hold", exact: true }).click(),
  ]);
  assert(vote.ok(), `Committee ballot rejected: ${await vote.text()}`);
  const afterUs = await db.collection("centralBanks").findOne({ _id: "US" as never });
  assert(afterUs);
  const meeting = afterUs.activeFomcMeeting ?? afterUs.fomcMeetingHistory.at(-1);
  assert(meeting, "Meeting must remain visible or have archived resolution");
  assert.equal(
    afterUs.fomcBoard
      .find((seat: { seatId: string }) => seat.seatId === "seat-1")
      ?.characterId?.toHexString(),
    SAVER.toHexString()
  );
  assert(
    meeting.ballots.some(
      (ballot: { seatId: string; auto: boolean; vote: string }) =>
        ballot.seatId === "seat-1" && ballot.auto === false && ballot.vote === "hold"
    ),
    "Actual player ballot must be recorded against its seat"
  );
  writeFileSync(
    `${process.env.JOURNEY_SCREENSHOT_PREFIX}.us-vote.json`,
    JSON.stringify(
      { beforeRate: beforeUs.primeRate, afterRate: afterUs.primeRate, meeting },
      null,
      2
    )
  );
  console.log("completed US committee UI ballot");
  await page
    .screenshot({
      path: `${process.env.JOURNEY_SCREENSHOT_PREFIX}-committee.png`,
      fullPage: true,
      timeout: 5000,
    })
    .catch(() => console.log("Optional committee screenshot unavailable"));
  await switchToIrishChair();
  const beforeIe = await db.collection("centralBanks").findOne({ _id: "IE" as never });
  assert(beforeIe);
  const irelandResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/country/ie/central-bank" &&
      r.request().method() === "GET",
    { timeout: 180_000 }
  );
  const [irelandRead] = await Promise.all([
    irelandResponse,
    page.goto(`${base}/centralbank/iep`, { waitUntil: "domcontentloaded", timeout: 180_000 }),
  ]);
  assert(irelandRead.ok(), "Irish authority read must succeed before setting the rate");
  await page.getByRole("button", { name: "+", exact: true }).click();
  await page
    .getByPlaceholder("Reason (optional)")
    .fill("Synthetic sandbox player-journey qualification");
  const rateResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith("/central-bank/rate") && r.request().method() === "POST",
    { timeout: 180_000 }
  );
  const [rate] = await Promise.all([
    rateResponse,
    page.getByRole("button", { name: "Confirm Rate Change", exact: true }).click(),
  ]);
  assert(rate.ok(), `Irish rate command rejected: ${await rate.text()}`);
  const afterIe = await db.collection("centralBanks").findOne({ _id: "IE" as never });
  assert(afterIe);
  assert(afterIe.primeRate > beforeIe.primeRate);
  assert.equal(afterIe.primeRate, Math.round(beforeIe.primeRate * 4) / 4 + 0.25);
  await page.getByText(/On cooldown/).waitFor();
  assert(await page.getByRole("button", { name: "+", exact: true }).isDisabled());
  await page
    .screenshot({
      path: `${process.env.JOURNEY_SCREENSHOT_PREFIX}-irish-rate.png`,
      fullPage: true,
      timeout: 5000,
    })
    .catch(() => console.log("Optional Irish screenshot unavailable"));
  console.log("completed Irish chair UI rate and cooldown");
  return {
    us: { beforeRate: beforeUs.primeRate, afterRate: afterUs.primeRate, meeting },
    ireland: {
      beforeRate: beforeIe.primeRate,
      afterRate: afterIe.primeRate,
      lastRateChangeTurn: afterIe.lastRateChangeTurn,
      cooldownVisible: true,
    },
  };
}
