import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { wikiPublicPageMetadata } from "@/lib/siteMetadata";
import { corporationWikiSlug, partyWikiSlug, playerWikiSlug } from "@/lib/wiki/playerPages";
import { WIKI_CREATE_COOLDOWN_HOURS } from "@/lib/wiki/createCooldown";
import type { Corporation, PoliticalParty, WikiPage } from "@/lib/db/types";
import { ClaimButton } from "./ClaimButton";

export const metadata: Metadata = wikiPublicPageMetadata({
  title: "My Wiki Pages | A House Divided",
  description:
    "Create and edit wiki pages for your politician, corporation, party, or a historical event.",
  pathname: "/wiki/my",
});

export default async function MyWikiPage() {
  const user = await getAuthUserWithCharacter();
  if (!user) redirect("/login?returnUrl=/wiki/my");
  if (!user.character) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-3 font-serif text-2xl font-bold text-foreground">My Wiki Pages</h1>
        <p className="text-muted">
          You need an active character to create player-authored wiki pages.{" "}
          <Link href="/create-character" className="text-primary hover:underline">
            Finish onboarding
          </Link>{" "}
          first.
        </p>
      </div>
    );
  }

  const character = user.character;
  const db = await getDb();

  const [corp, party] = await Promise.all([
    db.collection<Corporation>("corporations").findOne({
      ceoId: character._id,
      userId: character.userId,
    }),
    db.collection<PoliticalParty>("politicalParties").findOne({
      $or: [
        { chairId: character._id },
        { viceChairId: character._id },
        { treasurerId: character._id },
      ],
    }),
  ]);

  const playerSlug =
    typeof character.sequentialId === "number" ? playerWikiSlug(character.sequentialId) : null;
  const corpSlug =
    corp && typeof corp.sequentialId === "number" ? corporationWikiSlug(corp.sequentialId) : null;
  const partySlug = party ? partyWikiSlug(party.countryId, party.sequentialId) : null;

  const wikiPages = db.collection<WikiPage>("wikiPages");
  const [playerPage, corpPage, partyPage] = await Promise.all([
    playerSlug ? wikiPages.findOne({ slug: playerSlug }) : Promise.resolve(null),
    corpSlug ? wikiPages.findOne({ slug: corpSlug }) : Promise.resolve(null),
    partySlug ? wikiPages.findOne({ slug: partySlug }) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8">
        <p className="section-label mb-2">Player-authored pages</p>
        <h1 className="mb-2 font-serif text-3xl font-bold tracking-tight text-foreground">
          My Wiki Pages
        </h1>
        <p className="max-w-2xl text-muted">
          Claim dedicated wiki pages for your politician, your corporation, the party you lead, or a
          historical event. Use the in-app editor — full markdown, inline image uploads, wiki
          cross-links, and tables.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PageCard
          kind="player"
          title={character.name}
          subtitle="Your politician"
          page={playerPage}
          slug={playerSlug}
        />
        <PageCard
          kind="corporation"
          title={corp ? corp.name : "No corporation"}
          subtitle={corp ? "Company you run as CEO" : "You are not a CEO"}
          page={corpPage}
          slug={corpSlug}
          disabled={!corp}
          disabledMessage="You can create a corporation page once you found or are appointed CEO of a company."
        />
        <PageCard
          kind="party"
          title={party ? party.name : "No party leadership role"}
          subtitle={party ? "Party you help lead" : "Not a party officer"}
          page={partyPage}
          slug={partySlug}
          disabled={!party}
          disabledMessage="Only a party's chair, vice-chair, or treasurer can claim its wiki page."
        />
        <EventCard />
      </div>

      <LimitationsBlock />
    </div>
  );
}

function LimitationsBlock() {
  return (
    <div className="mt-10 rounded-xl border border-card-border bg-card/40 p-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
        Rules &amp; limitations
      </h2>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>
          <strong>Moderator review.</strong> Every new page starts in &ldquo;pending review.&rdquo;
          Edits to a live page return it to review. You&rsquo;ll be notified by bell when a
          moderator approves or rejects.
        </li>
        <li>
          <strong>{WIKI_CREATE_COOLDOWN_HOURS}-hour cooldown between new pages.</strong> Edits are
          unlimited, so flesh out a page rather than spinning up new ones.
        </li>
        <li>
          <strong>Markdown &amp; wiki links.</strong> Standard markdown plus{" "}
          <code>[[Page Title]]</code> wiki links, tables, and code-fence widgets.
        </li>
        <li>
          <strong>Images.</strong> PNG / JPEG / WebP / GIF up to 8 MB via the toolbar button.
          External image URLs must be <code>http(s)</code> — <code>javascript:</code> and other
          schemes are blocked.
        </li>
        <li>
          <strong>Hyperlinks.</strong> Regular markdown <code>[label](https://example.com)</code>{" "}
          works; external links open in a new tab with
          <code> rel=&quot;noopener noreferrer&quot;</code>.
        </li>
        <li>
          <strong>No slurs, harassment, spam, or link-stuffing.</strong> A content filter rejects
          the most obvious cases up front; moderators enforce the rest.
        </li>
      </ul>
    </div>
  );
}

function EventCard() {
  return (
    <div className="flex flex-col rounded-xl border border-card-border bg-card p-6">
      <p className="section-label mb-1">Historical event</p>
      <h2 className="mb-4 font-serif text-xl font-bold text-foreground">
        Document a moment in history
      </h2>
      <p className="mb-4 text-sm text-muted">
        Market crashes, landmark elections, major scandals — anyone can draft an event page. Because
        the slug is your choice, use the general &ldquo;new article&rdquo; flow.
      </p>
      <div className="mt-auto">
        <Link
          href="/wiki/new?category=events"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New event page
        </Link>
      </div>
    </div>
  );
}

interface PageCardProps {
  kind: "player" | "corporation" | "party";
  title: string;
  subtitle: string;
  page: WikiPage | null;
  slug: string | null;
  disabled?: boolean;
  disabledMessage?: string;
}

function PageCard({ kind, title, subtitle, page, slug, disabled, disabledMessage }: PageCardProps) {
  const status = page?.status;
  return (
    <div className="flex flex-col rounded-xl border border-card-border bg-card p-6">
      <p className="section-label mb-1">{subtitle}</p>
      <h2 className="mb-4 font-serif text-xl font-bold text-foreground">{title}</h2>

      {disabled ? (
        <p className="text-sm text-muted">{disabledMessage}</p>
      ) : page && slug ? (
        <>
          <p className="mb-4 text-sm text-muted">
            Status:{" "}
            <span className="font-medium text-foreground">
              {status === "published"
                ? "Published"
                : status === "pending_review"
                  ? "Pending review"
                  : status === "draft"
                    ? "Draft"
                    : status === "archived"
                      ? "Archived"
                      : "Unknown"}
            </span>
          </p>
          <div className="mt-auto flex flex-wrap gap-2">
            <Link
              href={`/wiki/${slug}/edit`}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Edit page
            </Link>
            {status === "published" && (
              <Link
                href={`/wiki/${slug}`}
                className="rounded-md border border-card-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                View live
              </Link>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            You haven&apos;t claimed this page yet. Claiming creates a starter draft and opens the
            editor.
          </p>
          <div className="mt-auto">
            <ClaimButton kind={kind} />
          </div>
        </>
      )}
    </div>
  );
}
