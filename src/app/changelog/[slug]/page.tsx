import { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { loadPublicPosts } from "@/lib/changelog/posts";
import { ChangelogPostView } from "./ChangelogPostView";

interface PageParams {
  params: Promise<{ slug: string }>;
}

/**
 * One release, rendered as a full post.
 *
 * The feed at /changelog now carries only each release's headline and summary;
 * the body lives here. That split is the point: entries read as dev diaries with
 * room for images and charts, instead of a wall of accordions the reader has to
 * expand one at a time to find anything.
 *
 * `/changelog/legacy` is a sibling static route and wins over this dynamic
 * segment in Next's routing precedence, so the pre-0.4.0 archive is unaffected.
 */

/** Pre-render every published post; the set only changes on deploy. */
export function generateStaticParams() {
  return loadPublicPosts().map((post) => ({ slug: post.slug }));
}

/**
 * Posts are read off the filesystem at build time, so the set of valid slugs is
 * fully known and closed. Turning off dynamic params makes an unknown slug a
 * real HTTP 404 rather than a 200 that merely renders the not-found page — a
 * soft 404 is worth avoiding on a public, indexable route.
 */
export const dynamicParams = false;

function findPost(slug: string) {
  return loadPublicPosts().find((p) => p.slug === slug) ?? null;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const post = findPost(slug);
  if (!post) {
    return publicPageMetadata({
      title: "Release not found | A House Divided",
      description: "This release does not exist.",
      pathname: `/changelog/${slug}`,
    });
  }
  return publicPageMetadata({
    title: `${post.title} (v${post.version}) | A House Divided`,
    description: post.summary || `Release notes for A House Divided v${post.version}.`,
    pathname: `/changelog/${post.slug}`,
  });
}

export default async function ChangelogPostPage({ params }: PageParams) {
  const { slug } = await params;
  const posts = loadPublicPosts();
  const index = posts.findIndex((p) => p.slug === slug);
  if (index === -1) notFound();

  // Posts are sorted newest first, so the *next* index is the older release.
  return (
    <ChangelogPostView
      post={posts[index]}
      newer={index > 0 ? posts[index - 1] : null}
      older={index < posts.length - 1 ? posts[index + 1] : null}
    />
  );
}
