import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  applySuspendEndorseCampaignStrengthTransfers,
  applySuspendEndorseStateOrgTransfers,
  buildSuspendEndorseLinks,
} from "./suspendEndorseTransfers";

describe("suspendEndorseTransfers", () => {
  const suspenderId = new ObjectId();
  const endorsedId = new ObjectId();

  it("buildSuspendEndorseLinks ignores non-suspended and missing endorse targets", () => {
    expect(
      buildSuspendEndorseLinks([
        {
          _id: suspenderId,
          characterId: new ObjectId(),
          campaignSuspended: true,
          endorsedElectionCandidateId: new ObjectId(),
        },
        {
          _id: endorsedId,
          characterId: new ObjectId(),
        },
      ])
    ).toEqual([]);

    expect(
      buildSuspendEndorseLinks([
        {
          _id: suspenderId,
          characterId: new ObjectId(),
        },
      ])
    ).toEqual([]);
  });

  it("transfers 25% campaign strength from suspender to endorsed character", () => {
    const suspenderChar = new ObjectId();
    const endorsedChar = new ObjectId();
    const links = buildSuspendEndorseLinks([
      {
        _id: suspenderId,
        characterId: suspenderChar,
        campaignSuspended: true,
        endorsedElectionCandidateId: endorsedId,
      },
      {
        _id: endorsedId,
        characterId: endorsedChar,
      },
    ]);

    const cs = new Map<string, number>([
      [suspenderChar.toString(), 10_000],
      [endorsedChar.toString(), 2_000],
    ]);
    applySuspendEndorseCampaignStrengthTransfers(cs, links);

    expect(cs.get(suspenderChar.toString())).toBe(7_500);
    expect(cs.get(endorsedChar.toString())).toBe(4_500);
  });

  it("uses nppId as the campaign-strength key for NPP endorse targets", () => {
    const suspenderChar = new ObjectId();
    const endorsedNppId = new ObjectId();
    const links = buildSuspendEndorseLinks([
      {
        _id: suspenderId,
        characterId: suspenderChar,
        campaignSuspended: true,
        endorsedElectionCandidateId: endorsedId,
      },
      {
        _id: endorsedId,
        characterId: new ObjectId(),
        isNPP: true,
        nppId: endorsedNppId,
      },
    ]);

    const cs = new Map<string, number>([
      [suspenderChar.toString(), 4_000],
      [endorsedNppId.toString(), 1_000],
    ]);
    applySuspendEndorseCampaignStrengthTransfers(cs, links);

    expect(cs.get(suspenderChar.toString())).toBe(3_000);
    expect(cs.get(endorsedNppId.toString())).toBe(2_000);
  });

  it("transfers 25% per-state org from suspender to endorsed election candidate", () => {
    const suspenderChar = new ObjectId();
    const endorsedChar = new ObjectId();
    const links = buildSuspendEndorseLinks([
      {
        _id: suspenderId,
        characterId: suspenderChar,
        campaignSuspended: true,
        endorsedElectionCandidateId: endorsedId,
      },
      {
        _id: endorsedId,
        characterId: endorsedChar,
      },
    ]);

    const stateOrg = new Map<string, Map<string, number>>([
      [
        "PA",
        new Map([
          [suspenderId.toString(), 80],
          [endorsedId.toString(), 20],
        ]),
      ],
    ]);
    applySuspendEndorseStateOrgTransfers(stateOrg, links);

    expect(stateOrg.get("PA")?.get(suspenderId.toString())).toBe(60);
    expect(stateOrg.get("PA")?.get(endorsedId.toString())).toBe(40);
  });
});
