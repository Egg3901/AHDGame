import { getDb } from "@/lib/mongodb";
import type { WikiPage } from "@/lib/db/types";
import { gameStartingStateContent } from "@/lib/seeds/wiki/content/gameStartingState";
import { cabinetGuideContent } from "@/lib/seeds/wiki/content/cabinetGuide";
import { plantsCorpGuideContent } from "@/lib/seeds/wiki/content/plantsCorpGuide";

const CODE_BACKED_WIKI_CONTENT: Record<string, string> = {
  "game-starting-state": gameStartingStateContent,
  "cabinet-guide": cabinetGuideContent,
  "plants-corp-guide": plantsCorpGuideContent,
};

/**
 * Transform markdown wikilinks to internal links.
 * Queries DB for page titles to resolve [[Page Title]] syntax.
 */
async function transformWikiLinks(markdown: string): Promise<string> {
  const db = await getDb();
  const pages = await db
    .collection<WikiPage>("wikiPages")
    .find({ status: "published" })
    .project({ title: 1, slug: 1 })
    .toArray();

  const titleMap = new Map<string, string>();
  pages.forEach((p) => titleMap.set(p.title.toLowerCase(), p.slug));

  return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, pageTitle, displayText) => {
    const slug = titleMap.get(pageTitle.trim().toLowerCase());
    const rawLinkText = displayText?.trim() || pageTitle.trim();
    // Escape markdown link-syntax characters so link text cannot break out of the
    // wrapping [text](url) structure (defence-in-depth; titleMap values are trusted).
    const linkText = rawLinkText.replace(/([\\`*_[\]()<>])/g, "\\$1");

    if (slug) {
      return `[${linkText}](/wiki/${slug})`;
    }
    // Broken link — emit plain italic markdown. react-markdown escapes raw HTML,
    // so we never round-trip user text through an HTML string.
    return `_${linkText}_`;
  });
}

/**
 * Load markdown content for a wiki page from DB.
 * Transforms [[wikilinks]] for in-app navigation.
 */
export async function loadWikiContent(slug: string): Promise<string | null> {
  const db = await getDb();
  const dbPage = await db.collection<WikiPage>("wikiPages").findOne({
    slug,
    status: "published",
    private: { $ne: true },
  });

  if (!dbPage) return null;

  // Code-backed pages always render from current code, so they can never rot.
  // game-starting-state keeps its legacy exception: a DB copy that already
  // embeds the starting-state-dashboard widget is left as-is (admin-edited).
  const codeBackedContent = CODE_BACKED_WIKI_CONTENT[slug];
  const useCodeBacked =
    codeBackedContent !== undefined &&
    !(slug === "game-starting-state" && dbPage.content.includes("starting-state-dashboard"));
  const content = useCodeBacked ? codeBackedContent : dbPage.content;

  return transformWikiLinks(content);
}
