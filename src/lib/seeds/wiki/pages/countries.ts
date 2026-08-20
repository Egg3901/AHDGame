import type { WikiSeedPage } from "../types";
import { usOverviewContent } from "../content/usOverview";
import { ukOverviewContent } from "../content/ukOverview";
import { deOverviewContent } from "../content/deOverview";
import { jpOverviewContent } from "../content/jpOverview";
import { ieOverviewContent } from "../content/ieOverview";
import { brOverviewContent } from "../content/brOverview";
import { cnOverviewContent } from "../content/cnOverview";
import { ngOverviewContent } from "../content/ngOverview";
import { ruOverviewContent } from "../content/ruOverview";
import { ddOverviewContent } from "../content/ddOverview";

export const countriesPages: readonly WikiSeedPage[] = [
  {
    slug: "us-overview",
    title: "United States",
    description:
      "Federal presidential republic with 50 states, a bicameral Congress, and a directly elected President.",
    content: usOverviewContent,
    category: "countries",
    countryId: "US",
    featured: true,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 7,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "uk-overview",
    title: "United Kingdom",
    description:
      "Westminster parliamentary democracy across four nations: 650 Commons seats, confidence votes, and a Prime Minister.",
    content: ukOverviewContent,
    category: "countries",
    countryId: "UK",
    featured: false,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 8,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "de-overview",
    title: "Germany",
    description:
      "Federal parliamentary republic with mixed-member proportional representation and coalition government across 16 states.",
    content: deOverviewContent,
    category: "countries",
    countryId: "DE",
    featured: false,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 7,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "jp-overview",
    title: "Japan",
    description:
      "Parliamentary constitutional monarchy with a bicameral elected Diet, snap elections, and the exclusive Cabinet Bills mechanic.",
    content: jpOverviewContent,
    category: "countries",
    countryId: "JP",
    featured: false,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 9,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "ie-overview",
    title: "Ireland",
    description:
      "Parliamentary republic with PR-STV elections, a 160-seat Dáil, coalition government, and a ceremonial Uachtarán: shares the ECB with the Eurozone.",
    content: ieOverviewContent,
    category: "countries",
    countryId: "IE",
    featured: false,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 7,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "br-overview",
    title: "Brazil",
    description:
      "Federal presidential republic with open-list proportional representation, a bicameral National Congress of 513 deputies and 81 senators, and fragmented multi-party politics.",
    content: brOverviewContent,
    category: "countries",
    countryId: "BR",
    featured: false,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 7,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "cn-overview",
    title: "China",
    description:
      "One-party state governed by the CCP, with a 2,980-seat National People's Congress, an internal-party confidence model, a ceremonial President auto-synced to the CCP chair, and a one-way regime-conversion path.",
    content: cnOverviewContent,
    category: "countries",
    countryId: "CN",
    featured: false,
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 9,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "ng-overview",
    title: "Nigeria",
    description:
      "Federal presidential republic with FPTP elections, a bicameral National Assembly of 109 senators and 360 representatives, 36 states, and a high-inflation monetary baseline.",
    content: ngOverviewContent,
    category: "countries",
    countryId: "NG",
    featured: false,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 7,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "ru-overview",
    title: "Soviet Union",
    description:
      "One-party socialist union governed by the CPSU: a bill-active bicameral Supreme Soviet, 17 macro-regions, a Gosplan command economy, and permanent command of the Warsaw Pact. Playable in the 1953 and 1979 presets.",
    content: ruOverviewContent,
    category: "countries",
    countryId: "RU",
    featured: false,
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 9,
    lastUpdated: "2026-08-11",
  },
  {
    slug: "dd-overview",
    title: "East Germany",
    description:
      "SED-led one-party state with a 500-seat Volkskammer elected on the single National Front list, four approved bloc parties, six regions, a planned economy, and Warsaw Pact founding membership. Playable in the 1953 and 1979 presets.",
    content: ddOverviewContent,
    category: "countries",
    countryId: "DD",
    featured: false,
    difficulty: "intermediate",
    contentType: "reference",
    estimatedReadTime: 8,
    lastUpdated: "2026-08-11",
  },
];
