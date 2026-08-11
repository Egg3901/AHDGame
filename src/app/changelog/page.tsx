import { Metadata } from "next";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { loadPublicPosts } from "@/lib/changelog/posts";
import { searchableProse } from "@/lib/changelog/postUtils";
import { ChangelogClient } from "./ChangelogClient";

export const metadata: Metadata = publicPageMetadata({
  title: "What's New | A House Divided",
  description:
    "Release notes and feature updates for A House Divided: balance changes, new systems for politics and the economy, and quality-of-life improvements.",
  pathname: "/changelog",
});

export default function ChangelogPage() {
  // The feed never renders a body — it links to /changelog/[slug] instead — but
  // it does search across every release. Ship the prose, not the raw markdown:
  // same search results, without pushing each post's chart JSON and image paths
  // to a page that displays neither. Reading time is unaffected (its own
  // estimator strips fences and images anyway).
  const publicPosts = loadPublicPosts().map((post) => ({
    ...post,
    body: searchableProse(post.body),
  }));
  return <ChangelogClient publicPosts={publicPosts} />;
}
