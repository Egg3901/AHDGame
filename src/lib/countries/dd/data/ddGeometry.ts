/**
 * East Berlin (`BEO`) geometry. Both Cold-War presets seed East Germany on the
 * eastern-Länder codes (BEO/MV/BB/ST/SN/TH); the five Länder render from the
 * germany shard by ownership, but `BEO` has no shape there (BE is West Berlin;
 * Brandenburg carries Berlin as an interior enclave hole), so this one-feature
 * shard supplies the Berlin outline — lifted from Brandenburg's interior ring
 * by `scripts/maps/build-dd-geo.mjs`, filling BB's hole exactly.
 *
 * World map: excluded (`worldOverlay: false` in the manifest) — the world
 * overlay already folds `BE` onto Brandenburg's owner, covering all of Berlin.
 */
export const DD_GEO_URL = "/dd-regions.json";

/** The codes this shard carries. */
export const DD_SHARD_CODES = ["BEO"] as const;

/** Compact on-map label — "Berlin (Ost)" overflows the small enclave tile. */
export const DD_LABEL_OVERRIDES: Record<string, string> = {
  BEO: "Berlin",
};
