import { describe, it, expect, beforeEach, vi } from "vitest";
import type { EditorStateConfig } from "./types";

// Minimal localStorage stub — jsdom is not installed in this project
const store: Record<string, string> = {};
const localStorageStub = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
  get length() {
    return Object.keys(store).length;
  },
  key: (i: number) => Object.keys(store)[i] ?? null,
  clear: () => {
    for (const k of Object.keys(store)) delete store[k];
  },
};
vi.stubGlobal("window", { localStorage: localStorageStub });

import { loadOverride, saveOverride, clearOverride, overrideKey } from "./storage";

const cfg = {
  era: "2019",
  countryId: "US",
  stateId: "CA",
  layer1: {},
  archetypes: [],
} as unknown as EditorStateConfig;

describe("override store", () => {
  beforeEach(() => localStorageStub.clear());

  it("round-trips a config", () => {
    saveOverride(cfg);
    expect(loadOverride("2019", "US", "CA")).toEqual(cfg);
  });

  it("clear removes it", () => {
    saveOverride(cfg);
    clearOverride("2019", "US", "CA");
    expect(loadOverride("2019", "US", "CA")).toBeNull();
  });

  it("key format is stable", () => {
    expect(overrideKey("2019", "US", "CA")).toBe("posed:2019:US:CA");
  });
});
