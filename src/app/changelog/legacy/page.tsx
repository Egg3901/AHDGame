import fs from "fs";
import { Metadata } from "next";
import { LEGACY_PUBLIC_PATH } from "@/lib/changelog/paths";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { parsePublicChangelog } from "../changelogUtils";
import { LegacyChangelogClient } from "./LegacyChangelogClient";

export const metadata: Metadata = publicPageMetadata({
  title: "Legacy Changelog | A House Divided",
  description:
    "Archived player-facing release notes for A House Divided before the v0.4.0 post-style feed.",
  pathname: "/changelog/legacy",
});

export default function LegacyChangelogPage() {
  const raw = fs.readFileSync(LEGACY_PUBLIC_PATH, "utf-8");
  const entries = parsePublicChangelog(raw);
  return <LegacyChangelogClient entries={entries} />;
}
