import type { WikiPageContentType, WikiPageDifficulty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Authoritative player-facing wiki page definition.
 *
 * Phase 0+ convention: every wiki page rendered under /wiki/<slug> (except the
 * special live routes: /wiki/elections, /wiki/roadmap, /wiki/paths/*, /wiki/party/*,
 * /wiki/seat/*, /wiki/leadership/*) must have a corresponding WikiSeedPage entry
 * aggregated from category files in this directory. The seeder upserts these into
 * the `wikiPages` collection; admin edits in the UI are preserved unless reseeded
 * with `--force`.
 */
export interface WikiSeedPage {
  slug: string;
  title: string;
  description: string;
  content: string;

  /** Primary category id from WIKI_CATEGORIES. Also used as the first tag. */
  category: string;

  /** Extra tags beyond the category. Useful for cross-references and search. */
  extraTags?: string[];

  /** Shown in featured homepage quick-links. */
  featured?: boolean;

  difficulty?: WikiPageDifficulty;
  contentType?: WikiPageContentType;
  estimatedReadTime?: number;

  /** Optional country scoping for country-specific pages (e.g. 'united-kingdom'). */
  countryId?: CountryId;

  /** Admin-only page: hidden from public index and API unless the caller is admin. */
  private?: boolean;

  /**
   * ISO date (YYYY-MM-DD) of the last git commit that touched this page's
   * content file. Shown as the "Updated <date>" badge. Not wall-clock reseed time.
   */
  lastUpdated: string;

  /**
   * Path after the docs host, e.g. "design/elections.html".
   * Rendered as a Design doc chip linking to NEXT_PUBLIC_DOCS_URL/<this>.
   */
  designDocUrl?: string;
}
