import { z } from "zod";
import { CARVE_FRACTION_MAX, CARVE_FRACTION_MIN } from "@/lib/nationalization/constants";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";

/**
 * Executive nationalization request. Either a whole-corp taking
 * (`corporationId`) or a single-sector taking (`sectorId`), never both.
 */
export const executiveNationalizeSchema = z
  .object({
    corporationId: z.string().length(24).optional(),
    sectorId: z.string().length(24).optional(),
    /** Executive emergency tiers only — fair buyout requires the legislative path (P3). */
    tier: z.enum(["discounted", "seizure"]),
  })
  .refine((d) => !!d.corporationId !== !!d.sectorId, {
    message: "Provide exactly one of corporationId or sectorId",
  });

export type ExecutiveNationalizeBody = z.infer<typeof executiveNationalizeSchema>;

/**
 * Executive privatization request (spec §13): carve one or more sectors out of a
 * National Corporation into a new private corp, distributed by IPO float or auction.
 */
export const executivePrivatizeSchema = z.object({
  selections: z
    .array(
      z.object({
        sectorId: z.string().length(24),
        carveFraction: z.number().min(CARVE_FRACTION_MIN).max(CARVE_FRACTION_MAX),
      })
    )
    .min(1)
    .max(10),
  newCorpName: z.string().trim().min(2).max(60),
  goldenSharePercent: z.number().min(0).max(1).default(0),
  method: z.enum(["ipo", "auction"]).default("ipo"),
  /** Auction reserve in country currency; optional (defaults to the carve valuation). */
  reservePrice: z.number().positive().optional(),
  /**
   * IPO headquarters region (a region of the corp's country). Optional; defaults
   * to the first carved sector's region. Validated against the country's regions
   * in the engine. Ignored for auctions (the winner's region is set on sale).
   */
  headquartersState: z.string().min(1).optional(),
});

export type ExecutivePrivatizeBody = z.infer<typeof executivePrivatizeSchema>;

/** Place/raise a bid on an open privatization auction (escrow at bid time). */
export const auctionBidSchema = z.object({
  amount: z.number().positive(),
  asCorporationId: z.string().length(24).optional(),
});

export type AuctionBidBody = z.infer<typeof auctionBidSchema>;

/** Designate / remove a strategic sector type (spec §6.3/§8). */
export const designateStrategicSectorSchema = z.object({
  sectorType: z.enum(CORPORATION_TYPES),
});

export type DesignateStrategicSectorBody = z.infer<typeof designateStrategicSectorSchema>;
