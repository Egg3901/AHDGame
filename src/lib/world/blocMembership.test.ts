import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { loadBlocMapData, rivalBlocOrgsFor } from "./blocMembership";
import { buildAlignmentTopology } from "@/lib/alignment/rules/customBlocs";
import { ALIGNMENT_POLES } from "@/lib/constants/alignmentEras";

describe("rivalBlocOrgsFor", () => {
  it("answers the Warsaw Pact for NATO in a Cold War world", () => {
    expect(rivalBlocOrgsFor("1953-default", "NATO")).toEqual(["WARSAW_PACT"]);
  });

  it("answers NATO for the Warsaw Pact", () => {
    expect(rivalBlocOrgsFor("1953-default", "WARSAW_PACT")).toEqual(["NATO"]);
  });

  it("has no opinion about an org that does not govern accession", () => {
    // Joining the UN costs a country nothing it already holds.
    expect(rivalBlocOrgsFor("1953-default", "UN")).toEqual([]);
  });

  it("names no rival where the era has only one accession channel", () => {
    // The Warsaw Pact dissolves in 1991: Moscow and Beijing carry no bloc org
    // after it, so NATO membership excludes nothing.
    expect(rivalBlocOrgsFor("2019-default", "NATO")).toEqual([]);
  });

  it("keys on the preset, never on the live year", () => {
    // A 1953 world still has a Warsaw Pact in its year 2050. Reading the era off
    // the clock instead of the preset would return nothing here the moment a
    // Cold War game passed 1991, and the exclusivity would go silently inert.
    expect(rivalBlocOrgsFor("1953-default", "NATO")).toEqual(["WARSAW_PACT"]);
  });

  it("treats a player-founded Bloc as a rival to every other accession pole", () => {
    const topology = buildAlignmentTopology(1953, Object.values(ALIGNMENT_POLES), [
      {
        organizationId: "andes-pact",
        name: "Andes Pact",
        shortName: "AP",
        founderCountryId: "BR",
        accentToken: "warning",
      },
    ]);

    expect(rivalBlocOrgsFor("1953-default", "andes-pact", topology.channels)).toEqual([
      "NATO",
      "WARSAW_PACT",
    ]);
    expect(rivalBlocOrgsFor("1953-default", "NATO", topology.channels)).toEqual([
      "WARSAW_PACT",
      "andes-pact",
    ]);
  });
});

describe("loadBlocMapData", () => {
  it("combines preset and player-founded treaty rolls with pole metadata", async () => {
    const rows = [
      { organizationId: "NATO", countryId: "US" },
      { organizationId: "andes-pact", countryId: "BR" },
      { organizationId: "andes-pact", countryId: "AR" },
    ];
    const db = {
      collection: (name: string) => {
        if (name === "customInternationalOrganizations") {
          return {
            find: () => ({
              project: () => ({
                toArray: async () => [
                  {
                    id: "andes-pact",
                    name: "Andes Pact",
                    shortName: "AP",
                    creatorCountryId: "BR",
                    category: "bloc",
                    createdOnTurn: 10,
                    alignment: { poleId: "ORG:andes-pact", accentToken: "warning" },
                  },
                ],
              }),
            }),
          };
        }
        if (name === "organizationMemberships") {
          return {
            find: (query: { organizationId: { $in: string[] } }) => ({
              toArray: async () =>
                rows.filter((row) => query.organizationId.$in.includes(row.organizationId)),
            }),
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      },
    } as unknown as Db;

    const data = await loadBlocMapData(db, "2019-default");
    expect(data.membership).toMatchObject({
      US: "west",
      BR: "ORG:andes-pact",
      AR: "ORG:andes-pact",
    });
    expect(data.customBlocs).toEqual([
      { poleId: "ORG:andes-pact", label: "Andes Pact", accentToken: "warning" },
    ]);
  });
});
