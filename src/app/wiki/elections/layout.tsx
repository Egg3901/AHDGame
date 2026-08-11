import type { Metadata } from "next";
import { wikiPublicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = wikiPublicPageMetadata({
  title: "Election History — Wiki | A House Divided",
  description:
    "Historical election results across every country and level of office. Browse by year, type, or region.",
  pathname: "/wiki/elections",
});

export default function WikiElectionsListLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
