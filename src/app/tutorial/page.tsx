import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { TutorialHubClient } from "./TutorialHubClient";

export const metadata: Metadata = publicPageMetadata({
  title: "Tutorial | A House Divided",
  description:
    "Every chapter of the A House Divided guided tour: getting started, running for office, investing, running a company, running a union, and running a nation.",
  pathname: "/tutorial",
});

export default function TutorialHubPage() {
  return <TutorialHubClient />;
}
