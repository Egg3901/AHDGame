import { describe, expect, it } from "vitest";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary } from "../orgTypes";
import { memberEntityIds, memberFeatureIds } from "./orgMembership";

const org = (members: string[]): OrgSummary =>
  ({
    id: "NATO",
    def: { id: "NATO", name: "NATO", shortName: "NATO", category: "security" },
    members: members.map((countryId) => ({ countryId })),
    identity: resolveOrgIdentity("NATO", false, "NATO", "security"),
  }) as unknown as OrgSummary;

describe("memberFeatureIds", () => {
  it("shades members the game models as countries", () => {
    const ids = memberFeatureIds(org(["US", "FR"]));
    expect(ids.has("840")).toBe(true); // United States
    expect(ids.has("250")).toBe(true); // France
  });

  it("shades background members too — the map said six while the list said fourteen", () => {
    // Canada and the Benelux carry map geometry but no CountryId. Resolving
    // membership through CountryId left NATO's real 1953 alliance unshaded.
    const ids = memberFeatureIds(org(["CA", "NL", "BE", "LU", "IS"]));
    expect(ids.has("124")).toBe(true); // Canada
    expect(ids.has("528")).toBe(true); // Netherlands
    expect(ids.has("056")).toBe(true); // Belgium
    expect(ids.has("442")).toBe(true); // Luxembourg
    expect(ids.has("352")).toBe(true); // Iceland
  });

  it("covers NATO's whole 1953 roster, and nothing beyond it", () => {
    const roster = [
      "US",
      "UK",
      "FR",
      "IT",
      "TR",
      "GR",
      "CA",
      "NL",
      "BE",
      "LU",
      "NO",
      "DK",
      "PT",
      "IS",
    ];
    const ids = memberFeatureIds(org(roster));
    // Every metropole is drawn...
    const metropoles = [
      "840",
      "826",
      "250",
      "380",
      "792",
      "300",
      "124",
      "528",
      "056",
      "442",
      "578",
      "208",
      "620",
      "352",
    ];
    for (const iso of metropoles) expect(ids.has(iso), iso).toBe(true);
    // ...and nothing else. Several members carry more than one feature, so this
    // is not a count of fourteen — but it must stay in that neighbourhood
    // rather than ballooning to the ~89 that dependency shading produced.
    expect(ids.size).toBeLessThan(roster.length * 2);
  });

  it("does not shade a member's colonies", () => {
    // The legend says "Members of NATO". Painting Kenya and Malaya alongside
    // the signatories made the map claim they had joined — which the North
    // Atlantic Treaty's Article 6 goes out of its way to deny, drawing a treaty
    // area that covers Algeria and the North Atlantic islands and excludes the
    // members' other possessions.
    const ids = memberFeatureIds(org(["FR"]));
    expect(ids.has("250")).toBe(true); // France itself
    expect(ids.has("384")).toBe(false); // Ivory Coast
    expect(ids.has("788")).toBe(false); // Tunisia
    expect(ids.size).toBeLessThan(5);
  });

  it("ignores a member with no geometry rather than throwing", () => {
    // Some entities are modelled without a map feature; they simply do not shade.
    expect(memberFeatureIds(org(["ZZ"])).size).toBe(0);
  });

  it("is empty when no organisation is selected", () => {
    expect(memberFeatureIds(null).size).toBe(0);
  });

  it("claims only present-day footprints, leaving the eras to the overlay", () => {
    // A Cold War entity's territory is drawn by a region-overlay blob unioned
    // from live ownership, and the base features it covers are dropped before
    // this set is consulted. Hardcoding the USSR's republics here instead would
    // paint fifteen separate countries a shared colour — internal borders and
    // all — and would keep painting them if territory ever changed hands.
    const ru = memberFeatureIds(org(["RU"]));
    expect(ru.has("643")).toBe(true); // Russia's own feature
    expect(ru.has("804")).toBe(false); // Ukraine belongs to the soviet-union blob
    expect(ru.has("398")).toBe(false); // as does Kazakhstan

    // Czechoslovakia and Yugoslavia have no modern feature at all; their shards
    // are the only thing that draws them.
    expect(memberFeatureIds(org(["CS"])).size).toBe(0);
    expect(memberFeatureIds(org(["YU"])).size).toBe(0);
  });

  it("has no feature for East Germany, which the germany shard draws instead", () => {
    // DD's territory sits INSIDE Germany's single base polygon, so there is no
    // ISO feature to shade. The overlay splits the Länder by live owner and
    // gives DD a blob of its own — see memberEntityIds.
    expect(memberFeatureIds(org(["DD"])).size).toBe(0);
  });
});

describe("memberEntityIds", () => {
  it("is the key an overlay blob is matched on", () => {
    // Blobs are identified by the country that owns their regions, not by any
    // ISO code — which is how East Germany and the Soviet Union shade at all.
    const ids = memberEntityIds(org(["DD", "RU"]));
    expect(ids.has("DD")).toBe(true);
    expect(ids.has("RU")).toBe(true);
  });

  it("carries members and nothing else", () => {
    // Byelorussia and the Baltics still SHADE in a Cold War world, but through
    // the soviet-union shard rather than through this set: they sit inside the
    // USSR's own geometry, so RU's blob already draws them.
    const ids = memberEntityIds(org(["RU"]));
    expect(ids).toEqual(new Set(["RU"]));
  });

  it("is exactly the membership, for a bloc with no territory at all", () => {
    expect(memberEntityIds(org(["IS"]))).toEqual(new Set(["IS"]));
  });

  it("is empty when no organisation is selected", () => {
    expect(memberEntityIds(null).size).toBe(0);
  });
});
