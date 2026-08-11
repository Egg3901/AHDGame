import { describe, it, expect, vi, beforeEach } from "vitest";

const setTag = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  setTag: (...a: unknown[]) => setTag(...a),
}));

import { setGameContext, officeLabel } from "./gameContext";
import type { OfficeType } from "@/lib/db/types/character";

describe("observability/gameContext", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("setGameContext", () => {
    it("tags turn number and office type", () => {
      const office: OfficeType = { type: "senate", state: "CA" };
      setGameContext(487, office);

      expect(setTag).toHaveBeenCalledWith("game.turn", 487);
      expect(setTag).toHaveBeenCalledWith("game.office", "senate:CA");
      expect(setTag).toHaveBeenCalledWith("game.officeState", "CA");
    });

    it("tags 'none' when no office", () => {
      setGameContext(42, null);

      expect(setTag).toHaveBeenCalledWith("game.turn", 42);
      expect(setTag).toHaveBeenCalledWith("game.office", "none");
    });

    it("tags 'none' when office is undefined", () => {
      setGameContext(99, undefined);

      expect(setTag).toHaveBeenCalledWith("game.turn", 99);
      expect(setTag).toHaveBeenCalledWith("game.office", "none");
    });

    it("tags president without state", () => {
      const office: OfficeType = { type: "president" };
      setGameContext(100, office);

      expect(setTag).toHaveBeenCalledWith("game.office", "president");
      // officeState should not be set for offices without state
      const stateCalls = setTag.mock.calls.filter((c) => c[0] === "game.officeState");
      expect(stateCalls).toHaveLength(0);
    });
  });

  describe("officeLabel", () => {
    it("house with state", () => {
      expect(officeLabel({ type: "house", state: "TX", seatsHeld: 1 })).toBe("house:TX");
    });

    it("governor with state", () => {
      expect(officeLabel({ type: "governor", state: "OH" })).toBe("governor:OH");
    });

    it("president", () => {
      expect(officeLabel({ type: "president" })).toBe("president");
    });

    it("chancellor", () => {
      expect(officeLabel({ type: "chancellor" })).toBe("chancellor");
    });

    it("primeMinister with state", () => {
      expect(officeLabel({ type: "primeMinister", state: "UK" })).toBe("primeMinister:UK");
    });

    it("usCabinet with positionId", () => {
      expect(officeLabel({ type: "usCabinet", positionId: "sec_state" })).toBe(
        "usCabinet:sec_state"
      );
    });

    it("unknown type falls through", () => {
      expect(officeLabel({ type: "custom", state: "XX" })).toBe("custom:XX");
    });
  });
});
