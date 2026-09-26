import { describe, expect, it } from "vitest";
import {
  buildCreationContextRequest,
  creationContextKey,
  inferCreationContextNeeds,
} from "./contextNeeds";

describe("inferCreationContextNeeds", () => {
  it("asks for Discord link when the opener has no linked game account", () => {
    expect(
      inferCreationContextNeeds({
        title: "Crash",
        description: "It crashed.",
        hasGameIdentity: false,
      })
    ).toContain("discord");
    expect(
      inferCreationContextNeeds({
        title: "Crash",
        description: "It crashed.",
        hasGameIdentity: true,
      })
    ).not.toContain("discord");
  });

  it("asks for the corporation link only for corporation reports without one", () => {
    const corp = {
      title: "CEO pay",
      description: "Shareholder vote is stuck.",
      hasGameIdentity: true,
    };
    expect(inferCreationContextNeeds(corp)).toContain("corporation");
    expect(
      inferCreationContextNeeds({ ...corp, corporationUrl: "https://game/corporation/1" })
    ).not.toContain("corporation");
    expect(
      inferCreationContextNeeds({
        title: "Crash",
        description: "It crashed.",
        hasGameIdentity: true,
      })
    ).not.toContain("corporation");
  });

  it("asks for the page link when the report is about a page with no usable URL", () => {
    const base = {
      title: "Market page",
      description: "The market screen does not load.",
      hasGameIdentity: true,
    };
    expect(inferCreationContextNeeds(base)).toContain("page");
    expect(
      inferCreationContextNeeds({
        ...base,
        description: "See https://game.example/market for the broken screen.",
      })
    ).not.toContain("page");
    // Character/corporation links do not satisfy a page question.
    expect(
      inferCreationContextNeeds({ ...base, description: "See https://game.example/character/5." })
    ).toContain("page");
  });
});

describe("creationContextKey", () => {
  it("is null for no needs and stable for a set", () => {
    expect(creationContextKey([])).toBeNull();
    expect(creationContextKey(["page"])).toBe(creationContextKey(["page"]));
    expect(creationContextKey(["page", "discord"])).toBe(creationContextKey(["discord", "page"]));
  });

  it("matches the dashboard ledger format", () => {
    expect(creationContextKey(["page"])).toMatch(/^context:[0-9a-f]{16}$/);
  });

  it("matches the dashboard key for the same needs (production ticket #1339)", () => {
    expect(creationContextKey(["page"])).toBe("context:767013ce0ee0f6d7");
  });
});

describe("buildCreationContextRequest", () => {
  it("carries the persisted shape the dashboard refines later", () => {
    const req = buildCreationContextRequest(
      {
        title: "Market page",
        description: "The market screen does not load.",
        hasGameIdentity: true,
      },
      new Date("2026-09-20T00:00:00Z")
    );
    expect(req.version).toBe(1);
    expect(req.needed).toEqual(["page"]);
    expect(req.generatedBy).toBe("creation-deterministic");
    expect(req.generatedAt).toBe("2026-09-20T00:00:00.000Z");
  });
});
