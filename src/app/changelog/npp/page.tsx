import fs from "fs";
import Link from "next/link";
import { Metadata } from "next";
import { NPP_CHANGELOG_PATH } from "@/lib/changelog/paths";
import { NPP_ENGINE_LEVEL, NPP_ENGINE_VERSION } from "@/lib/nppAutonomy/engineVersion";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { HeroStatsStrip } from "@/components/ui";
import { ChangelogMarkdown } from "../components/ChangelogMarkdown";

export const metadata: Metadata = publicPageMetadata({
  title: "NPP engine changelog | A House Divided",
  description:
    "Version history and roadmap for the non-player politician engine in A House Divided: elections, governing, legislation and companies.",
  pathname: "/changelog/npp",
});

/** The file's own H1 duplicates the page header, so it is dropped. */
function bodyWithoutTitle(raw: string): string {
  return raw.replace(/^# .*\n+/, "");
}

export default function NppChangelogPage() {
  const raw = fs.readFileSync(NPP_CHANGELOG_PATH, "utf-8");
  const versions = raw.match(/^## \d/gm)?.length ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 pb-20">
      <header className="mb-8 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
        <div className="p-6">
          <h1 className="mb-1 text-2xl font-bold tracking-tight text-foreground">
            NPP engine changelog
          </h1>
          <p className="text-sm text-muted">
            How non-player politicians decide, version by version, and what is planned next.
          </p>
        </div>
        <HeroStatsStrip>
          <div className="flex min-w-max flex-col px-5 py-3">
            <span className="text-body-sm font-medium text-muted">Engine</span>
            <span className="text-base font-bold tabular-nums text-primary">
              {NPP_ENGINE_VERSION}
            </span>
          </div>
          <div className="flex min-w-max flex-col px-5 py-3">
            <span className="text-body-sm font-medium text-muted">Runs at autonomy</span>
            <span className="text-base font-bold tabular-nums text-foreground">
              {NPP_ENGINE_LEVEL} and above
            </span>
          </div>
          <div className="flex min-w-max flex-col px-5 py-3">
            <span className="text-body-sm font-medium text-muted">Versions</span>
            <span className="text-base font-bold tabular-nums text-foreground">{versions}</span>
          </div>
          <div className="flex min-w-max flex-col px-5 py-3">
            <span className="text-body-sm font-medium text-muted">Game releases</span>
            <Link
              href="/changelog"
              className="text-base font-bold text-foreground hover:text-primary"
            >
              Main changelog
            </Link>
          </div>
        </HeroStatsStrip>
      </header>

      <article className="rounded-2xl border border-card-border bg-card p-6">
        <ChangelogMarkdown content={bodyWithoutTitle(raw)} />
      </article>
    </div>
  );
}
