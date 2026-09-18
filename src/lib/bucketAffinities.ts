import { US_DOMAIN_BUCKET_AFFINITIES } from "@/lib/countries/us/data/usBucketAffinities";
import { UK_DOMAIN_BUCKET_AFFINITIES } from "@/lib/countries/uk/data/ukBucketAffinities";
import { IE_DOMAIN_BUCKET_AFFINITIES } from "@/lib/countries/ie/data/ieBucketAffinities";
import { JP_DOMAIN_BUCKET_AFFINITIES } from "@/lib/countries/jp/data/jpBucketAffinities";
import { DE_DOMAIN_BUCKET_AFFINITIES } from "@/lib/countries/de/data/deBucketAffinities";
import { CN_DOMAIN_BUCKET_AFFINITIES } from "@/lib/countries/cn/data/cnBucketAffinities";
/**
 * Domain affinities in the Layer-1 census-bucket vocabulary.
 *
 * How each bucket of voters reacts to a RIGHTWARD policy shift in a domain.
 * Positive = likes rightward shifts, negative = likes leftward, magnitude = how
 * much that bucket cares. At bill enactment:
 *
 *     impact = (newPosition - oldPosition) x affinity x SHIFT_IMPACT_SCALE
 *
 * WHY BUCKETS
 * -----------
 * The tables these replace were keyed on each country's voter ARCHETYPES. An
 * archetype is an authoring format: the vote engine counts census cells, so an
 * archetype-keyed approval only ever reached voters by being projected onto
 * buckets at read time. Authoring on buckets removes the round trip, and with
 * it the failure mode that came along for the ride — an archetype id with no
 * mapping projected onto nothing and vanished, which is how an entire country's
 * approval effects could be dropped with no error anywhere.
 *
 * HOW THESE VALUES WERE PRODUCED
 * ------------------------------
 * By running each country's authored archetype table through
 * `archetypeValuesToBuckets`, the exact projection the engine applied at read
 * time. This file is therefore behaviour-identical to the tables it replaces by
 * construction rather than by inspection, and any later hand-tuning is a design
 * change measurable against a known-equal baseline instead of a design change
 * entangled with a migration.
 *
 * Two things to know before tuning:
 *
 * - Weight is redistributed, not re-derived. Where two archetypes shared a
 *   bucket their affinities SUMMED, so a bucket can carry more weight than any
 *   single archetype did. That is what the engine already computed.
 * - Buckets are not mutually exclusive the way archetypes were. A cell picks up
 *   the sum of every bucket it matches, one per dimension.
 *
 * From here on this file is the source and is hand-edited: once the archetype
 * tables are gone there is nothing left to regenerate from.
 */

/** Per-country, per-domain bucket affinities. Countries absent fall back to US. */
export const DOMAIN_BUCKET_AFFINITIES: Record<string, Record<string, Record<string, number>>> = {
  US: US_DOMAIN_BUCKET_AFFINITIES,
  UK: UK_DOMAIN_BUCKET_AFFINITIES,
  IE: IE_DOMAIN_BUCKET_AFFINITIES,
  JP: JP_DOMAIN_BUCKET_AFFINITIES,
  DE: DE_DOMAIN_BUCKET_AFFINITIES,
  CN: CN_DOMAIN_BUCKET_AFFINITIES,
};

/**
 * Bucket affinities for a country + domain, falling back to the US table.
 *
 * The fallback is the historical behaviour and is deliberately kept: a country
 * with no table of its own gets approximate effects rather than none, and
 * "none" is the failure mode that is invisible.
 */
export function bucketAffinitiesFor(
  countryId: string | undefined,
  domain: string
): Record<string, number> {
  const table = countryId ? DOMAIN_BUCKET_AFFINITIES[countryId.toUpperCase()] : undefined;
  return (
    (table ?? DOMAIN_BUCKET_AFFINITIES.US)[domain] ?? DOMAIN_BUCKET_AFFINITIES.US[domain] ?? {}
  );
}
