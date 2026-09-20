import type { ScotusPresetSeed } from "./types";

/**
 * Turn-one Supreme Court for `2027-default` (#2170).
 *
 * The roster is the nine-member Court listed by the Supreme Court when this
 * fallback was reviewed on 2026-09-20, carried forward to the January 2027
 * preset. No seat is vacant in the reviewed roster. This is explicitly a
 * projection, not a claim to know the future bench. The preset also cannot
 * truthfully ship a curated historical docket for decisions after its start
 * date: those outcomes do not exist yet. Its explicit, reviewed fallback is
 * therefore an empty curated docket plus the existing procedural surprise-case system.
 * This is intentionally different from copying the 2019 docket, whose
 * 2020-2024 cases would all be overdue and resolve on turn one.
 *
 * Lean and party values retain the established 2019 content model. They are
 * game inputs, not claims about formal party membership.
 */
export const SCOTUS_2027_DEFAULT_SEED: ScotusPresetSeed = {
  seats: [
    {
      seatNumber: 1,
      historicalOccupants: [
        {
          key: "roberts-2027",
          name: "John Roberts",
          party: "2",
          economicLean: -1,
          socialLean: -1,
          seatedYear: 2027,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    {
      seatNumber: 2,
      historicalOccupants: [
        {
          key: "thomas-2027",
          name: "Clarence Thomas",
          party: "2",
          economicLean: 4,
          socialLean: 5,
          seatedYear: 2027,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    {
      seatNumber: 3,
      historicalOccupants: [
        {
          key: "barrett-2027",
          name: "Amy Coney Barrett",
          party: "2",
          economicLean: 3,
          socialLean: 4,
          seatedYear: 2027,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    {
      seatNumber: 4,
      historicalOccupants: [
        {
          key: "jackson-2027",
          name: "Ketanji Brown Jackson",
          party: "1",
          economicLean: -3,
          socialLean: -4,
          seatedYear: 2027,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    {
      seatNumber: 5,
      historicalOccupants: [
        {
          key: "alito-2027",
          name: "Samuel Alito",
          party: "2",
          economicLean: 4,
          socialLean: 5,
          seatedYear: 2027,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    {
      seatNumber: 6,
      historicalOccupants: [
        {
          key: "sotomayor-2027",
          name: "Sonia Sotomayor",
          party: "1",
          economicLean: -3,
          socialLean: -5,
          seatedYear: 2027,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    {
      seatNumber: 7,
      historicalOccupants: [
        {
          key: "kagan-2027",
          name: "Elena Kagan",
          party: "1",
          economicLean: -3,
          socialLean: -4,
          seatedYear: 2027,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    {
      seatNumber: 8,
      historicalOccupants: [
        {
          key: "gorsuch-2027",
          name: "Neil Gorsuch",
          party: "2",
          economicLean: 3,
          socialLean: 2,
          seatedYear: 2027,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    {
      seatNumber: 9,
      historicalOccupants: [
        {
          key: "kavanaugh-2027",
          name: "Brett Kavanaugh",
          party: "2",
          economicLean: -1,
          socialLean: 3,
          seatedYear: 2027,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
  ],
  docket: [],
  provenance: {
    roster: {
      mode: "reviewed-current-roster-fallback",
      asOf: "2026-09-20",
      projectedFor: "2027-01-01",
      source: "https://www.supremecourt.gov/about/biographies.aspx",
      limitation:
        "Projects the reviewed 2026 membership unchanged to January 2027; any intervening vacancy or appointment requires this preset to be revised.",
    },
    docket: {
      mode: "procedural-only-fallback",
      reviewedAt: "2026-09-20",
      source: "src/lib/scotus/surpriseCaseTemplates.ts",
      limitation:
        "No post-start historical outcomes are available; only the procedural surprise docket is enabled until reviewed historical content exists.",
    },
  },
};
