import type { V3LaneContent } from "./types";

/** v3 slots 10-15 for the media lane. */
export const MEDIA_V3: V3LaneContent = {
  "1940": [
    {
      name: "Transcription Disc Reuse",
      description:
        "Recorded programs replay across the network instead of restaging every show live.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Flagship Sponsor Slots",
      description: "Named sponsorship of marquee programs sells airtime at top-of-card rates.",
      effects: [{ kind: "priceRealization", pct: 0.012 }],
    },
    {
      name: "War Bureau Accreditation",
      description:
        "Accredited correspondents keep the presses running when censors squeeze rivals.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Network Program Syndicates",
      description: "One production budget serves hundreds of stations through shared programming.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.05 },
      ],
    },
    {
      name: "National Advertiser Contracts",
      description:
        "Year-long national campaigns lock blue chip advertisers into premium schedules.",
      effects: [
        { kind: "priceRealization", pct: 0.022 },
        { kind: "outputRate", commodity: "advertising", pct: 0.06 },
      ],
    },
    {
      name: "License Portfolio Strategy",
      description: "Holding licenses across many cities makes any single regulator less dangerous.",
      effects: [
        { kind: "dominanceShield", pct: 0.17 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1950": [
    {
      name: "Kinescope Libraries",
      description: "Filmed reruns fill the schedule at a fraction of the cost of live production.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Spot Rate Cards",
      description: "Published rate cards tied to audited ratings hold ad prices firm.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Affiliate Contract Locks",
      description: "Long-term affiliation deals wall off station lineups from raiding networks.",
      effects: [{ kind: "dominanceShield", pct: 0.09 }],
    },
    {
      name: "Telefilm Production Lots",
      description: "Assembly-line filmed series bring factory economics to prime time.",
      effects: [
        { kind: "laborCostReduction", pct: 0.07 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Ratings Premium Selling",
      description: "Top-rated slots auctioned against measured audiences fetch record prices.",
      effects: [
        { kind: "priceRealization", pct: 0.024 },
        { kind: "outputRate", commodity: "advertising", pct: 0.07 },
      ],
    },
    {
      name: "Station Group Expansion",
      description: "Buying stations up to the ownership cap plants the flag in every major market.",
      effects: [
        { kind: "expansionDiscount", pct: 0.16 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1960": [
    {
      name: "Videotape Workflow",
      description: "Tape replaces film processing and same-day editing cuts production crews.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "electronics", pct: 0.05 },
      ],
    },
    {
      name: "Color Premium Slots",
      description: "Color broadcasts sold as a premium product raise the rate card again.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Public Interest Programming",
      description: "News and civic programming buys goodwill that protects licenses at renewal.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Centralized Master Control",
      description:
        "One master control feeds the whole group, and local crews shrink to news desks.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "inputCost", commodity: "electronics", pct: 0.1 },
      ],
    },
    {
      name: "Event Broadcasting Rights",
      description: "Exclusive rights to live spectacles sell sponsorships at unheard-of prices.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 28 },
      ],
    },
    {
      name: "International Format Sales",
      description: "Selling show formats abroad earns from markets the signal can never reach.",
      effects: [
        { kind: "expansionDiscount", pct: 0.15 },
        { kind: "tariffShield", pct: 0.15 },
      ],
    },
  ],
  "1970": [
    {
      name: "Electronic News Gathering",
      description: "Portable cameras and microwave vans file stories without film labs.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "electronics", pct: 0.05 },
      ],
    },
    {
      name: "Daypart Yield Selling",
      description:
        "Pricing each daypart against its exact audience squeezes more from the schedule.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Cross-Ownership Positioning",
      description:
        "Careful pairing of papers and stations stays inside the rules rivals trip over.",
      effects: [
        { kind: "dominanceShield", pct: 0.09 },
        { kind: "expansionDiscount", pct: 0.06 },
      ],
    },
    {
      name: "Automated Playout Systems",
      description: "Cartridge machines run the broadcast day with a skeleton overnight staff.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Mini-Series Event Pricing",
      description: "Multi-night event programming sells whole advertising packages at once.",
      effects: [
        { kind: "priceRealization", pct: 0.025 },
        { kind: "outputRate", commodity: "advertising", pct: 0.07 },
      ],
    },
    {
      name: "Satellite Distribution Deals",
      description: "Transponder capacity carries the signal past any local franchise fight.",
      effects: [
        { kind: "tariffShield", pct: 0.16 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "1979": [
    {
      name: "Newsroom Wire Automation",
      description: "Computer wire queues route copy straight to editors and cut rekeying staff.",
      effects: [{ kind: "laborCostReduction", pct: 0.04 }],
    },
    {
      name: "Zoned Ad Editions",
      description: "Neighborhood ad zones let one paper sell the same page many times.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "outputRate", commodity: "advertising", pct: 0.03 },
      ],
    },
    {
      name: "Cable Franchise Bidding",
      description:
        "Winning municipal cable franchises early locks up whole cities for a generation.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Pagination Systems",
      description: "Screen-composed pages eliminate paste-up rooms and hot type entirely.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "inputCost", commodity: "electronics", pct: 0.1 },
      ],
    },
    {
      name: "Upfront Market Leadership",
      description: "Selling the season upfront at scale sets the market price for everyone else.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "marketingStrength", flat: 27 },
      ],
    },
    {
      name: "Multi-City Franchise Wars",
      description:
        "A war chest and standard bid playbook wins franchise fights in city after city.",
      effects: [
        { kind: "expansionDiscount", pct: 0.17 },
        { kind: "dominanceShield", pct: 0.15 },
      ],
    },
  ],
  "1989": [
    {
      name: "Nonlinear Edit Suites",
      description: "Digital editing turns a day of razor cuts into an afternoon at a workstation.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "software", pct: 0.05 },
      ],
    },
    {
      name: "Branded Channel Spinoffs",
      description: "Spinning strong brands into niche channels sells the same audience twice.",
      effects: [{ kind: "priceRealization", pct: 0.013 }],
    },
    {
      name: "Retransmission Consent Play",
      description:
        "Charging carriers for must-have signals turns regulation into revenue leverage.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Server-Based Broadcast Chain",
      description: "Video servers replace tape rooms and one operator runs six channels.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Global Brand Licensing",
      description: "Licensing marquee media brands worldwide earns premiums with no new content.",
      effects: [
        { kind: "priceRealization", pct: 0.027 },
        { kind: "marketingStrength", flat: 30 },
      ],
    },
    {
      name: "Vertical Studio Integration",
      description: "Owning production, network and stations keeps every margin in the family.",
      effects: [
        { kind: "dominanceShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "1999": [
    {
      name: "Template Site Publishing",
      description: "One content system publishes every masthead to the web without extra desks.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "software", pct: 0.05 },
      ],
    },
    {
      name: "Vertical Ad Networks",
      description:
        "Bundling niche sites into themed networks sells remnant inventory at premium CPMs.",
      effects: [
        { kind: "priceRealization", pct: 0.012 },
        { kind: "outputRate", commodity: "advertising", pct: 0.04 },
      ],
    },
    {
      name: "Portal Distribution Deals",
      description: "Carriage on the big portals plants the brand in new markets overnight.",
      effects: [{ kind: "expansionDiscount", pct: 0.08 }],
    },
    {
      name: "Converged Newsroom Hubs",
      description: "Print, web and broadcast desks merge into one hub filing to every platform.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "inputCost", commodity: "software", pct: 0.1 },
      ],
    },
    {
      name: "Cross-Platform Sponsorships",
      description: "Selling TV, print and web as one package commands integrated campaign budgets.",
      effects: [
        { kind: "priceRealization", pct: 0.026 },
        { kind: "outputRate", commodity: "advertising", pct: 0.08 },
      ],
    },
    {
      name: "Global Content Alliances",
      description: "Co-production alliances clear content into markets closed to foreign owners.",
      effects: [
        { kind: "tariffShield", pct: 0.18 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
  "2009": [
    {
      name: "Metadata-Driven Archives",
      description: "Tagged archives let producers reuse footage instead of reshooting it.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "software", pct: 0.05 },
      ],
    },
    {
      name: "Behavioral Ad Targeting",
      description: "Audience data raises the price of every impression the sales desk moves.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Rights Windowing Strategy",
      description: "Staggered release windows wring value from each territory before piracy does.",
      effects: [{ kind: "tariffShield", pct: 0.1 }],
    },
    {
      name: "Cloud Production Pipeline",
      description: "Remote edit and render pipelines cut studios, couriers and overtime at once.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Premium Video Marketplaces",
      description:
        "Private marketplaces sell verified premium video well above open exchange rates.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "advertising", pct: 0.08 },
      ],
    },
    {
      name: "Territory Licensing Web",
      description: "A lattice of territory licenses earns from markets that ban direct entry.",
      effects: [
        { kind: "tariffShield", pct: 0.2 },
        { kind: "expansionDiscount", pct: 0.13 },
      ],
    },
  ],
  "2019": [
    {
      name: "Automated Clip Factories",
      description: "Software cuts broadcasts into social clips the moment they air.",
      effects: [
        { kind: "laborCostReduction", pct: 0.04 },
        { kind: "inputCost", commodity: "software", pct: 0.06 },
      ],
    },
    {
      name: "First-Party Data Selling",
      description: "Logged-in audience data sells campaigns rivals cannot measure or match.",
      effects: [{ kind: "priceRealization", pct: 0.014 }],
    },
    {
      name: "Platform Neutrality Deals",
      description:
        "Carriage on every platform keeps any single gatekeeper from squeezing the brand.",
      effects: [{ kind: "dominanceShield", pct: 0.1 }],
    },
    {
      name: "Virtual Production Stages",
      description: "LED volumes replace location shoots and slash crew, travel and set costs.",
      effects: [
        { kind: "laborCostReduction", pct: 0.08 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Addressable Ad Serving",
      description: "Per-household ad insertion sells one slot at a thousand different prices.",
      effects: [
        { kind: "priceRealization", pct: 0.028 },
        { kind: "outputRate", commodity: "advertising", pct: 0.09 },
      ],
    },
    {
      name: "Franchise Universe Expansion",
      description: "Interlocking franchises open every market a standalone title could not.",
      effects: [
        { kind: "expansionDiscount", pct: 0.18 },
        { kind: "dominanceShield", pct: 0.16 },
      ],
    },
  ],
  "2029": [
    {
      name: "AI-Assisted Newsdesks",
      description: "Drafting and versioning by machine lets small desks cover global beats.",
      effects: [
        { kind: "laborCostReduction", pct: 0.05 },
        { kind: "inputCost", commodity: "software", pct: 0.06 },
      ],
    },
    {
      name: "Attention-Verified Pricing",
      description: "Ads billed on verified attention rather than impressions carry a premium.",
      effects: [{ kind: "priceRealization", pct: 0.015 }],
    },
    {
      name: "Provenance Certification",
      description:
        "Cryptographic provenance marks make the outlet the trusted source in any market.",
      effects: [
        { kind: "dominanceShield", pct: 0.09 },
        { kind: "tariffShield", pct: 0.08 },
      ],
    },
    {
      name: "Synthetic Production Studios",
      description: "Generated sets, extras and dubs produce a season for the cost of a pilot.",
      effects: [
        { kind: "laborCostReduction", pct: 0.09 },
        { kind: "growthCostReduction", pct: 0.06 },
      ],
    },
    {
      name: "Personal Feed Sponsorships",
      description: "Sponsorships woven into individually assembled feeds price far above spots.",
      effects: [
        { kind: "priceRealization", pct: 0.03 },
        { kind: "outputRate", commodity: "advertising", pct: 0.09 },
      ],
    },
    {
      name: "Sovereign Content Vaults",
      description: "In-country content vaults satisfy data localization laws everywhere at once.",
      effects: [
        { kind: "tariffShield", pct: 0.22 },
        { kind: "expansionDiscount", pct: 0.14 },
      ],
    },
  ],
};
