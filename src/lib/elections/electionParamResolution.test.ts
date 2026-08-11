import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import { isElectionRouteSeatId, resolveElectionRouteParam } from "./electionParamResolution";
import type { Election } from "@/lib/db/types";

describe("electionParamResolution", () => {
  describe("isElectionRouteSeatId", () => {
    it("returns false for 24-char hex ObjectIds", () => {
      expect(isElectionRouteSeatId("507f1f77bcf86cd799439011")).toBe(false);
    });

    it("returns true for US-president", () => {
      expect(isElectionRouteSeatId("US-president")).toBe(true);
    });

    it("returns false for garbage strings", () => {
      expect(isElectionRouteSeatId("not-valid-id")).toBe(false);
    });
  });

  describe("resolveElectionRouteParam", () => {
    it("resolves by ObjectId", async () => {
      const oid = new ObjectId();
      const doc = { _id: oid, electionType: "president" } as Election;
      const findOne = vi.fn().mockResolvedValue(doc);
      const db = {
        collection: () => ({ findOne }),
      };
      const r = await resolveElectionRouteParam(db as never, oid.toString());
      expect(r.ok && r.election).toBeTruthy();
      if (r.ok) expect(r.election._id.equals(oid)).toBe(true);
      expect(findOne).toHaveBeenCalledWith({ _id: oid });
    });

    it("returns invalid_id for bad ObjectId shape", async () => {
      const db = { collection: () => ({ findOne: vi.fn() }) };
      const r = await resolveElectionRouteParam(db as never, "not-valid-id");
      expect(r).toEqual({ ok: false, reason: "invalid_id" });
    });

    it("prefers active seatId match", async () => {
      const upcoming = {
        _id: new ObjectId(),
        seatId: "US-president",
        status: "upcoming",
        cycle: 1,
      } as Election;
      const active = {
        _id: new ObjectId(),
        seatId: "US-president",
        status: "active",
        cycle: 2,
      } as Election;
      const toArray = vi.fn().mockResolvedValue([upcoming, active]);
      const db = {
        collection: () => ({
          find: () => ({
            sort: () => ({ limit: () => ({ toArray }) }),
          }),
        }),
      };
      const r = await resolveElectionRouteParam(db as never, "US-president");
      expect(r.ok && r.election._id.equals(active._id)).toBe(true);
    });
  });
});
