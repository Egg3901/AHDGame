export type ChangelogBadge = "major" | "patch" | "hotfix";
export type DevArea = "backend" | "frontend" | "fullstack";

export interface ChangelogPostMeta {
  version: string;
  date: string;
  title: string;
  summary: string;
  tags: string[];
  badges: ChangelogBadge[];
  era?: string;
  areas?: DevArea[];
}

export interface ChangelogPost extends ChangelogPostMeta {
  /** Markdown body (without frontmatter). */
  body: string;
  /** Source filename stem, e.g. "0.4.0". */
  slug: string;
}

export type PublicTagFilter = "all" | string;
export type DevAreaFilter = "all" | DevArea;
