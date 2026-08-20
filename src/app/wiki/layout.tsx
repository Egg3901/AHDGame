import React from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { getGameStateCollection } from "@/lib/db/collections";

/** Wiki pages read from MongoDB; avoid static generation at build time (CI may have no DB / no seed). */
export const dynamic = "force-dynamic";

function getMainSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_MAIN_SITE_URL?.trim().replace(/\/$/, "");
  if (raw?.startsWith("http://") || raw?.startsWith("https://")) return raw;
  return "https://ahousedividedgame.com";
}

/**
 * Slim wiki-only chrome for the wiki subdomain, where the game navbar is
 * deliberately suppressed (see the isWikiSubdomain gate in the root layout).
 * On the main site the game navbar is present, so this header is skipped.
 */
function WikiHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-card-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/wiki" className="font-serif text-base font-bold text-foreground">
            A House Divided Wiki
          </Link>
          <nav className="hidden items-center gap-3 text-sm text-muted sm:flex">
            <Link href="/wiki" className="transition-colors hover:text-foreground">
              Home
            </Link>
            <Link href="/wiki#guides" className="transition-colors hover:text-foreground">
              Guides
            </Link>
          </nav>
        </div>
        <a
          href={getMainSiteUrl()}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Back to game
        </a>
      </div>
    </header>
  );
}

export default async function WikiLayout({ children }: { children: React.ReactNode }) {
  const db = await getDb();
  const col = await getGameStateCollection(db);
  const gameState = await col.findOne({ _id: "current" });

  if (gameState?.wikiDisabled) {
    const user = await getAuthUser();
    if (!user?.isAdmin && !user?.isModerator) {
      redirect(user ? "/profile" : "/login");
    }
  }

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const isWikiSubdomain = host?.startsWith("wiki.") ?? false;

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-background">
      {isWikiSubdomain && <WikiHeader />}
      <main>{children}</main>
    </div>
  );
}
