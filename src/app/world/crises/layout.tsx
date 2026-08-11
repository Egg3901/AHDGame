import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Crises | A House Divided",
  description:
    "Active and historical crises affecting countries, regions, and sectors — their scope, duration, and effects on the simulation.",
  pathname: "/world/crises",
});

export default function CrisesListLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
