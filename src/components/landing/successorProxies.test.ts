import { describe, expect, it } from "vitest";
import { buildTierLookup, successorOwners, successorProxiesForYear } from "./countryTiers";
import { ERA_CONFIGS } from "./eraThemes";
import { WORLD_COUNTRY_ISO_TO_ID } from "@/lib/worldCountryRegistry";

const CZECHOSLOVAKIA = ["203", "703"];
const YUGOSLAV_REPUBLICS = ["191", "705", "070", "807", "688", "499"];

describe("successorProxiesForYear", () => {
  it("draws both states whole up to their break-ups", () => {
    for (const year of [1953, 1979, 1991]) {
      const proxies = successorProxiesForYear(year);
      expect(proxies.CS).toEqual(CZECHOSLOVAKIA);
      expect(proxies.YU).toEqual(YUGOSLAV_REPUBLICS);
    }
  });

  it("shrinks Yugoslavia to Serbia and Montenegro, then retires both", () => {
    expect(successorProxiesForYear(1999).CS).toBeUndefined();
    expect(successorProxiesForYear(1999).YU).toEqual(["688", "499"]);
    expect(successorProxiesForYear(2007)).toEqual({});
  });
});

describe("tier lookup with successor proxies", () => {
  const proxies = successorProxiesForYear(1991);

  it("paints Czechoslovakia and Yugoslavia over their successors in 1991", () => {
    const lookup = buildTierLookup(
      WORLD_COUNTRY_ISO_TO_ID,
      ERA_CONFIGS["1991"].accessMap,
      [],
      [],
      proxies
    );
    for (const id of [...CZECHOSLOVAKIA, ...YUGOSLAV_REPUBLICS]) {
      expect(lookup.get(id), id).toBe("economic");
    }
  });

  it("leaves the shapes alone without proxies, and for states the era does not name", () => {
    const plain = buildTierLookup(WORLD_COUNTRY_ISO_TO_ID, ERA_CONFIGS["1991"].accessMap);
    expect(plain.has("203")).toBe(false);
    const unnamed = buildTierLookup(
      WORLD_COUNTRY_ISO_TO_ID,
      { US: { enabledForPlayers: true } },
      [],
      [],
      proxies
    );
    expect(unnamed.has("688")).toBe(false);
  });

  it("maps each proxy feature back to the state it stands in for", () => {
    const owners = successorOwners(ERA_CONFIGS["1991"].accessMap, proxies);
    expect(owners.get("703")).toBe("CS");
    expect(owners.get("191")).toBe("YU");
    expect(owners.has("840")).toBe(false);
  });
});

describe("the 1991 landing roster", () => {
  it("names every state the 1991 world runs, Bulgaria and Yugoslavia included", () => {
    const ids = ERA_CONFIGS["1991"].nations.map((nation) => nation.id);
    for (const id of ["CS", "BG", "YU", "PL", "HU", "RO", "RU"]) expect(ids, id).toContain(id);
  });
});
