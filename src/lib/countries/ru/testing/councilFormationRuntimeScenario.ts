import { ObjectId } from "mongodb";
import { russianAssemblySeatingRuntimeScenario as scenario } from "./assemblySeatingRuntimeScenario";
import { materializeRussianAssemblySeating } from "../assemblySeating";
import {
  materializeRussianCouncilFormationProposal,
  authorizeRussianCouncilFormation,
} from "../councilFormationProposals";
export async function councilFormationRuntimeScenario(
  mode: "regionalHeads" | "regionalDelegates" = "regionalHeads",
  turn = 237
) {
  const fixture = scenario();
  await materializeRussianAssemblySeating(fixture.input);
  for (const [index, profile] of fixture.mem.collection("npps").docs.entries()) {
    profile.name = `Existing group ${index + 1}`;
    profile.party = String((index % 3) + 1);
  }
  // An unseated existing financial group supplies distinct regional nominees.
  fixture.mem.collection("npps").docs.push({
    _id: new ObjectId(),
    countryId: "RU",
    name: "Regional group",
    party: "1",
    money: 500,
  });
  const input = { ...fixture.input, turn, game: { preset: "1991-default" } };
  const proposal = await materializeRussianCouncilFormationProposal({
    ...input,
    sponsor: null,
    mode,
  });
  Object.assign(fixture.mem.collection("bills").docs[0], {
    status: "signed",
    enactedAt: input.now,
  });
  if (!(await authorizeRussianCouncilFormation({ ...input, proposalId: proposal._id })))
    throw new Error("Expected enacted fixture law");
  return { ...fixture, input };
}
