/** Portable Hungarian mixed-election sweep, independent of Mongo and server state. */
import { HU_1991_TERRITORIAL_DISTRICTS } from "../../src/lib/countries/hu/data/electoralDistricts1991";
import { buildHu1991Slates } from "../../src/lib/countries/hu/rules/slates1991";
import {
  projectHu1991CampaignBallots,
  projectHu1991Runoff,
} from "../../src/lib/countries/hu/rules/campaignBallots1991";
import { countHuMixed1991 } from "../../src/lib/countries/hu/rules/mixedElection1991";
import { settleHu1991Mandates } from "../../src/lib/countries/hu/rules/mandates1991";
const regions = [...new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId))];
let filled = 0,
  vacant = 0,
  playerMandates = 0,
  renewedCampaigns = 0,
  repeatedTerritorialBallots = 0;
for (let scenario = 0; scenario < 64; scenario++) {
  const nominees = regions.flatMap((regionId) =>
    ["A", "B", "C"].map((partyId, filingOrder) => ({
      id: `${regionId}:${partyId}`,
      ownerId: `existing:${regionId}:${partyId}`,
      isNpc: true,
      partyId,
      regionId,
      filingOrder,
    }))
  );
  const player = {
    id: "human",
    ownerId: "existing:human",
    isNpc: false,
    partyId: "A",
    regionId: regions[0],
    filingOrder: 0,
  };
  const { nominations } = buildHu1991Slates([player, ...nominees]);
  const campaign = (stage: number) =>
    regions.map((regionId) => ({
      regionId,
      registeredVoters: 10000,
      candidates: [player, ...nominees]
        .filter((row) => row.regionId === regionId)
        .map((row) => ({
          candidateId: row.id,
          votes:
            scenario % 8 === 0 && stage < 2
              ? 0
              : row.id === "human"
                ? 100
                : row.partyId === "A"
                  ? stage
                    ? 5100
                    : 2800 + scenario * 7
                  : row.partyId === "B"
                    ? stage
                      ? 3000
                      : 2500 - scenario * 7
                    : 900,
        })),
    }));
  let ballots = projectHu1991CampaignBallots(campaign(0), nominations);
  const firstProof = JSON.stringify(ballots);
  let count = countHuMixed1991(ballots);
  for (let stage = 1; count.kind === "pending" && stage <= 4; stage++) {
    renewedCampaigns++;
    repeatedTerritorialBallots += count.territorialRepeats?.length ?? 0;
    ballots = projectHu1991Runoff(ballots, count, campaign(stage), nominations);
    count = countHuMixed1991(ballots);
  }
  if (count.kind !== "counted")
    throw new Error("Hungarian fixture failed to complete genuine ballots");
  const installed = settleHu1991Mandates(count, nominations, new Set());
  if (installed.mandates.length + installed.vacancies.length !== 386)
    throw new Error("Hungarian fixture lost statutory mandates");
  const humanSeats = installed.mandates.filter((row) => row.ownerId === "existing:human").length;
  if (
    humanSeats > 1 ||
    new Set(installed.mandates.map((row) => row.personId)).size !== installed.mandates.length
  )
    throw new Error("Hungarian fixture duplicated a person");
  if (JSON.stringify(projectHu1991CampaignBallots(campaign(0), nominations)) !== firstProof)
    throw new Error("Hungarian first-round votes changed");
  filled += installed.mandates.length;
  vacant += installed.vacancies.length;
  playerMandates += humanSeats;
}
console.log(
  JSON.stringify(
    {
      scenarios: 64,
      filled,
      vacant,
      playerMandates,
      renewedCampaigns,
      repeatedTerritorialBallots,
      npcFinancialProfilesCreated: 0,
      scope: "Portable bounded election scenarios; not a full-world or historical candidate replay",
    },
    null,
    2
  )
);
