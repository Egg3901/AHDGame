/** Bounded regional composition sweep with matched support and existing financial identities. */
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../../src/lib/countries/ru/data/councilSubjects1993";
import {
  planRussianRegionalCouncilAppointments as appoint,
  planRussianRegionalCouncilRenewals as renew,
  planRussianRegionalCouncilDelegates as delegate,
} from "../../src/lib/countries/ru/rules/regionalCouncilAppointments";
import { planRussianCouncilComposition as compose } from "../../src/lib/countries/ru/rules/councilComposition";
import { planRussianCouncilCompositionDelta as delta } from "../../src/lib/countries/ru/rules/councilCompositionDelta";
let appointed = 0,
  deferred = 0,
  headMandates = 0,
  delegateMandates = 0,
  protectedHumanChoices = 0;
for (let seed = 0; seed < 64; seed++) {
  const profiles = Array.from({ length: 6 }, (_, index) => ({
    ownerId: `existing-financial-group-${index}`,
    party: String((index % 3) + 1),
    name: `Existing group ${index}`,
    eligible: seed % 8 !== 0 && (index + seed) % 4 !== 0,
  }));
  const support = Object.fromEntries(
    [...new Set(RUSSIAN_COUNCIL_SUBJECTS_1993.map(([, , region]) => region))].map(
      (region, index) => [
        region,
        Object.fromEntries(
          [1, 2, 3].map((party) => [
            String(party),
            10000 + ((seed + index * 13 + party * 29) % 97) * 100,
          ])
        ),
      ]
    )
  );
  const input = { turn: 240, revision: 1, termYears: 4, profiles, votesByRegion: support };
  const accountsBefore = JSON.stringify(profiles);
  const result = appoint(input);
  if (result.kind === "wait") {
    deferred++;
    continue;
  }
  if (
    JSON.stringify(appoint({ ...input, profiles: [...profiles].reverse() })) !==
    JSON.stringify(result)
  )
    throw new Error("Regional support result depends on profile iteration order");
  const heads = compose({ mode: "regionalHeads", turn: 240, authorities: result.authorities });
  if (heads.seats.length !== 178 || new Set(heads.seats.map((row) => row.personId)).size !== 178)
    throw new Error("Regional authorities did not supply distinct full Council mandates");
  const held = heads.seats.map((row, index) =>
    index === 0 ? { ...row, party: "independent" } : row
  );
  const unchanged = delta({
    desired: heads.seats,
    previous: heads.seats,
    held,
    endedPersonIds: [],
    newLaw: false,
  });
  if (
    unchanged.insert.length ||
    unchanged.retire.length ||
    unchanged.seated[0].party !== "independent"
  )
    throw new Error("Held regional mandate or party choice changed on replay");
  const authorities = result.authorities.map((row, index) =>
    index === 0 ? { ...row, head: { ...row.head, isNpc: false } } : row
  );
  const renewal = renew({ ...input, turn: 432, authorities });
  if (renewal.kind !== "renew" || renewal.changes.length !== 177)
    throw new Error("Regional expiry failed to preserve the pending human authority choice");
  const replacement = new Map(
    renewal.changes.map((row) => [`${row.subjectId}:${row.branch}`, row])
  );
  const renewed = authorities.map(
    (row) => replacement.get(`${row.subjectId}:${row.branch}`) ?? row
  );
  const delegated = delegate({ turn: 461, authorities: renewed, profiles });
  const delegates = compose({ mode: "regionalDelegates", turn: 461, authorities: delegated });
  if (
    delegates.seats.length !== 177 ||
    delegates.seats.some((row) => row.termEndTurn !== 624 || row.personId === row.authorityPersonId)
  )
    throw new Error("Delegation created fresh terms or implicitly assigned the human authority");
  if (JSON.stringify(profiles) !== accountsBefore)
    throw new Error("Regional decisions changed existing financial identities");
  appointed++;
  headMandates += heads.seats.length;
  delegateMandates += delegates.seats.length;
  protectedHumanChoices++;
}
console.log(
  JSON.stringify(
    {
      kind: "bounded-regional-council-composition",
      scenarios: 64,
      appointed,
      deferred,
      headMandates,
      delegateMandates,
      protectedHumanChoices,
      financialProfilesCreated: 0,
      supportModel: "synthetic-matched-regional-votes",
      regionalTermModel: "bounded-four-year-default",
      scope:
        "Portable regional composition and renewal only; not whole-world or economic conservation acceptance",
    },
    null,
    2
  )
);
