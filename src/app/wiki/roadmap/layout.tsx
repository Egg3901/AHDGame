import type { Metadata } from "next";
import { wikiPublicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = wikiPublicPageMetadata({
  title: "Roadmap | A House Divided",
  description:
    "Planned, in-progress, and completed features for A House Divided — alpha, beta, and release milestones.",
  pathname: "/wiki/roadmap",
});

export default function WikiRoadmapLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
