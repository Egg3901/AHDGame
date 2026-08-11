import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { WikiEditorClient } from "@/components/wiki/WikiEditorClient";
import { wikiPublicPageMetadata } from "@/lib/siteMetadata";
import { isPlayerSubmittableCategory } from "@/lib/wiki/categories";
import { WIKI_CREATE_COOLDOWN_HOURS } from "@/lib/wiki/createCooldown";

export const metadata: Metadata = wikiPublicPageMetadata({
  title: "Create Wiki Page | A House Divided",
  description:
    "Create or edit a wiki article for A House Divided: document mechanics, country rules, and strategy for other players (sign-in required).",
  pathname: "/wiki/new",
});

interface WikiNewPageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function WikiNewPage({ searchParams }: WikiNewPageProps) {
  const user = await getAuthUserWithCharacter();

  if (!user) {
    redirect("/login?returnUrl=/wiki/new");
  }

  // Moderators may also publish directly (same API access as admins for create/edit/delete).
  const canPublishDirectly = user.isAdmin === true || user.isModerator === true;
  const { category } = await searchParams;
  const initialCategory = category && isPlayerSubmittableCategory(category) ? category : undefined;

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Create New Wiki Page</h1>
          <p className="mt-1 text-sm text-muted">
            {canPublishDirectly
              ? "Create and publish a new wiki page immediately."
              : "Submit a new wiki page for moderator review."}
          </p>
        </div>

        {!canPublishDirectly && (
          <div className="mb-6 rounded-xl border border-card-border bg-card/40 p-4 text-sm text-muted">
            <p className="mb-1 font-semibold text-foreground">Before you start</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Pick a category — Characters, Corporations, Party profiles, Events, or Reference.
              </li>
              <li>
                {WIKI_CREATE_COOLDOWN_HOURS}-hour cooldown between new pages. Editing an existing
                page is always free.
              </li>
              <li>Pages are reviewed by a moderator; you&apos;ll be notified when they decide.</li>
              <li>No slurs, harassment, spam, link-stuffing, or all-caps writing.</li>
            </ul>
          </div>
        )}

        <WikiEditorClient
          mode="create"
          isAdmin={canPublishDirectly}
          initialCategory={initialCategory}
        />
      </div>
    </div>
  );
}
