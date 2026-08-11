import * as icons from "lucide-react";
import type { LucideIcon } from "lucide-react";

const fallback = icons.Award;

export function AchievementIcon({ name, className }: { name: string; className?: string }) {
  const candidate = icons[name as keyof typeof icons];
  const Icon = (
    typeof candidate === "object" || typeof candidate === "function" ? candidate : fallback
  ) as LucideIcon;
  return <Icon aria-hidden="true" className={className} />;
}
