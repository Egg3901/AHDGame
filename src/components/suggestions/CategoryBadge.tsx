import {
  SUGGESTION_CATEGORY_LABELS,
  SUGGESTION_CATEGORY_COLORS,
  SUGGESTION_GAME_SYSTEM_LABELS,
  GAME_SYSTEM_COLORS,
} from "@/components/FeedbackModal/constants";
import type { SuggestionCategory, SuggestionGameSystem } from "@/lib/db/types";

interface CategoryBadgeProps {
  category: SuggestionCategory;
  gameSystem: SuggestionGameSystem;
}

export function CategoryBadge({ category, gameSystem }: CategoryBadgeProps) {
  const catLabel = SUGGESTION_CATEGORY_LABELS[category] ?? category;
  const catColor = SUGGESTION_CATEGORY_COLORS[category] ?? "bg-muted/15 text-muted border-muted/30";
  const sysLabel = SUGGESTION_GAME_SYSTEM_LABELS[gameSystem] ?? gameSystem;
  const sysColor = GAME_SYSTEM_COLORS[gameSystem] ?? "bg-muted/15 text-muted";

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-tight ${catColor}`}
      >
        {catLabel}
      </span>
      <span
        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-tight ${sysColor}`}
      >
        {sysLabel}
      </span>
    </span>
  );
}
