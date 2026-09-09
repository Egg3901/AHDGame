import { expect, it } from "vitest";
import { makeCandidate, makeCharacter } from "@/lib/test-utils/factories";
import { applyStandingAds } from "./standingAds";
import { planAdPurchase, targetedAdBonuses, usesCampaignAds, type CampaignCell } from "./rules";

it("overlays standing exposure idempotently and retains previously paid candidate flights", () => {
  const ads = planAdPurchase([], { stateId: "CA", dimension: "race", bucket: "white" }, 10, 3)!;
  const old = planAdPurchase([], { stateId: "NY", dimension: "race", bucket: "white" }, 9, 1)!;
  const character = makeCharacter({ targetedAds: ads });
  const candidates = [
    makeCandidate({ characterId: character._id, targetedAds: old }),
    makeCandidate({ characterId: character._id }),
  ];
  const owners = new Map([[character._id.toString(), character]]);
  applyStandingAds(candidates, owners);
  applyStandingAds(candidates, owners);
  expect(candidates[0].targetedAds).toEqual([...old, ...ads]);
  expect(candidates[1].targetedAds).toEqual(ads);
  expect(character.targetedAds).toEqual(ads);
  expect(usesCampaignAds({}, candidates)).toBe(true);
  const cells: CampaignCell[] = [
    {
      id: "a",
      share: 1,
      turnout: 50,
      economicLean: 0,
      socialLean: 0,
      buckets: { race: "white" },
      identities: { race: { economicLean: 0, socialLean: 0 } },
    },
  ];
  const position = { economicLean: 0, socialLean: 0 };
  expect(targetedAdBonuses(cells, position, ads, "NY", 10).a).toBe(0);
  const early = targetedAdBonuses(cells, position, ads, "CA", 12).a;
  expect(early).toBeGreaterThan(0);
  expect(targetedAdBonuses(cells, position, ads, "CA", 84).a).toBeLessThan(early);
});
