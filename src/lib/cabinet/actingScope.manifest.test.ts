/**
 * The manifest's completeness guarantee.
 *
 * `requireConfirmedSecretary(member, "stance")` is readable at the call site but
 * says nothing about the routes that never call it: a new cabinet route ships
 * wide open and nothing notices. These tests walk the real route tree and hold
 * it against `CABINET_ROUTE_SCOPES`, so a mutating route cannot exist without
 * someone deciding, in writing, what an acting secretary may do with it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { CABINET_ROUTE_SCOPES } from "./actingScope";

const ROUTE_ROOT = path.join(
  process.cwd(),
  "src/app/api/country/[code]/executive/cabinet/[positionId]"
);

const MUTATING = /export async function (POST|PUT|PATCH|DELETE)\b/;

/**
 * Routes gated by a shared helper rather than in the route file itself. The
 * nuclear console funnels every mutation through `requireDefenceHolder` with
 * `intent: "manage"`, which applies the scope once for all of them.
 */
const GATED_BY_SHARED_HELPER = new Set([
  "nuclear/adopt",
  "nuclear/covert/breakout",
  "nuclear/covert/funding",
  "nuclear/production",
  "nuclear/test",
]);

/** Every route.ts under the cabinet position tree, keyed as the manifest keys it. */
function collectRoutes(dir: string, prefix = ""): Array<{ key: string; source: string }> {
  const out: Array<{ key: string; source: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRoutes(next, prefix ? `${prefix}/${entry.name}` : entry.name));
      continue;
    }
    if (entry.name !== "route.ts") continue;
    out.push({ key: prefix, source: readFileSync(next, "utf8") });
  }
  return out;
}

const routes = collectRoutes(ROUTE_ROOT).filter((r) => MUTATING.test(r.source));

describe("CABINET_ROUTE_SCOPES covers the route tree", () => {
  it("finds the cabinet routes on disk", () => {
    // Guards the walker itself: a bad path would make every test below vacuous.
    expect(routes.length).toBeGreaterThan(20);
  });

  it.each(routes.map((r) => r.key))("classifies %s", (key) => {
    expect(
      CABINET_ROUTE_SCOPES[key],
      `Route "${key}" has a mutating handler but no entry in CABINET_ROUTE_SCOPES. ` +
        `Decide what an acting secretary may do with it and add it to the manifest.`
    ).toBeDefined();
  });

  it("has no manifest entry for a route that does not exist", () => {
    const onDisk = new Set(routes.map((r) => r.key));
    const stale = Object.keys(CABINET_ROUTE_SCOPES).filter((key) => !onDisk.has(key));
    expect(stale, "manifest entries with no mutating route on disk").toEqual([]);
  });
});

describe("the routes enforce the scope the manifest records", () => {
  const barred = routes.filter(
    (r) => CABINET_ROUTE_SCOPES[r.key] && CABINET_ROUTE_SCOPES[r.key] !== "operational"
  );

  it.each(barred.map((r) => r.key))("%s guards its lever", (key) => {
    const route = barred.find((r) => r.key === key)!;
    if (GATED_BY_SHARED_HELPER.has(key)) return;
    expect(
      route.source,
      `Route "${key}" is recorded as scope "${CABINET_ROUTE_SCOPES[key]}" but never calls ` +
        `requireConfirmedSecretary, so an acting secretary can use it.`
    ).toContain("requireConfirmedSecretary");
  });

  it.each(barred.filter((r) => !GATED_BY_SHARED_HELPER.has(r.key)).map((r) => r.key))(
    "%s guards it with the scope the manifest records",
    (key) => {
      const route = barred.find((r) => r.key === key)!;
      const scope = CABINET_ROUTE_SCOPES[key];
      expect(
        route.source,
        `Route "${key}" is recorded as "${scope}" but guards a different scope.`
      ).toContain(`"${scope}"`);
    }
  );

  it("leaves operational routes ungated", () => {
    const wronglyGated = routes
      .filter((r) => CABINET_ROUTE_SCOPES[r.key] === "operational")
      .filter((r) => r.source.includes("requireConfirmedSecretary"))
      .map((r) => r.key);
    expect(wronglyGated, "routes recorded as operational but refusing acting secretaries").toEqual(
      []
    );
  });
});
