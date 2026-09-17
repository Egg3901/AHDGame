"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/** Links from a partial candidate summary to the complete election field. */
export function MoreCandidatesLink({
  candidateIds,
  visibleIds,
  href,
}: {
  candidateIds: string[];
  visibleIds: string[];
  href: string;
}) {
  const t = useTranslations("elections");
  const visible = new Set(visibleIds);
  const count = [...new Set(candidateIds)].filter((id) => !visible.has(id)).length;
  if (count === 0) return null;
  return (
    <Link href={href} className="block text-xs font-medium text-primary hover:underline">
      {t("card.moreCandidates", { count })}
    </Link>
  );
}
