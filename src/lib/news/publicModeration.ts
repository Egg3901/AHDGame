import type { Filter } from "mongodb";
import type { NewsPost } from "@/lib/db/types";

const visibleModerationFilter: Filter<NewsPost> = {
  $or: [{ moderation: { $exists: false } }, { "moderation.status": "visible" }],
};

/** Keep hidden and removed posts out of every public news read. */
export function withPublicNewsVisibility(query: Filter<NewsPost>): Filter<NewsPost> {
  return { $and: [query, visibleModerationFilter] };
}
