import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import BackButton from "@/components/BackButton";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { loadNewsPostPublic } from "@/lib/news/loadNewsPostPublic";
import { getSiteUrl, SITE_BRAND } from "@/lib/siteMetadata";

type Props = { params: Promise<{ id: string }> };

function toAbsoluteAssetUrl(base: string, pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  return `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const post = await loadNewsPostPublic(id);
  if (!post) {
    return {
      title: `Post not found | ${SITE_BRAND}`,
      robots: { index: false, follow: false },
    };
  }

  const base = getSiteUrl();
  const path = `/news/post/${id}`;
  const url = `${base}${path}`;
  const titleText = post.title
    ? `${post.title} | News | ${SITE_BRAND}`
    : `${post.authorName} — News | ${SITE_BRAND}`;
  // Wire posts can be a single word or a single punctuation mark. Echoing that
  // into the description produced live meta tags reading "." and "Tinky
  // Corporation", so anything too short to describe the page falls back.
  const trimmed = post.content.trim();
  const desc =
    trimmed.length < 40
      ? `An in-character player post on the ${SITE_BRAND} news wire.`
      : trimmed.length > 160
        ? `${trimmed.slice(0, 157)}…`
        : trimmed;

  const absImage = post.imageUrl ? toAbsoluteAssetUrl(base, post.imageUrl) : null;

  return {
    title: titleText,
    description: desc,
    // Every wire permalink is noindex, not just ads and system posts. These are
    // player-written in-character posts of a few dozen words each; Google
    // rejected the AdSense application on low value content while 68 of them
    // were indexed, and the section carries UGC the site would be held
    // responsible for. follow stays on so the crawler still walks back to /news.
    robots: { index: false, follow: true },
    alternates: { canonical: url },
    openGraph: {
      title: titleText,
      description: desc,
      url,
      type: "article",
      siteName: SITE_BRAND,
      locale: "en_US",
      publishedTime: post.createdAt.toISOString(),
      images: absImage
        ? [
            {
              url: absImage,
              width: 1200,
              height: 675,
              alt: post.title ? `Image: ${post.title}` : `Post by ${post.authorName}`,
            },
          ]
        : [
            {
              url: CDN_LOGO_URL,
              width: 512,
              height: 512,
              alt: SITE_BRAND,
            },
          ],
    },
    twitter: {
      card: "summary_large_image",
      title: titleText,
      description: desc,
      images: absImage ? [absImage] : [CDN_LOGO_URL],
    },
  };
}

export default async function NewsPostPermalinkPage({ params }: Props) {
  const { id } = await params;
  const post = await loadNewsPostPublic(id);
  if (!post) notFound();

  const base = getSiteUrl();
  const absImage = post.imageUrl ? toAbsoluteAssetUrl(base, post.imageUrl) : null;

  return (
    <div className="min-h-screen bg-background pb-16">
      <article className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <BackButton fallbackHref="/news" fallbackLabel="News feed" />
          <Link href="/news" className="text-xs text-muted hover:text-foreground transition-colors">
            All news →
          </Link>
        </div>

        <header className="mb-4 border-b border-card-border pb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {post.isSystem
              ? "Wire"
              : post.feedType === "advertisement"
                ? "Sponsored"
                : "Player post"}
          </p>
          {post.title && (
            <h1 className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">{post.title}</h1>
          )}
          <p className="mt-2 text-sm text-muted">
            <span className="font-medium text-foreground">{post.authorName}</span>
            <span className="mx-2">·</span>
            <time dateTime={post.createdAt.toISOString()}>
              {post.createdAt.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </p>
        </header>

        {absImage && !post.isSystem && (
          <div className="relative mb-6 aspect-video w-full overflow-hidden rounded-xl border border-card-border bg-card-muted">
            <Image
              src={absImage}
              alt={post.title ? `Image: ${post.title}` : `Image with post by ${post.authorName}`}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 672px"
              priority
              unoptimized={
                (!!post.imageUrl && bypassNextImageOptimization(post.imageUrl)) ||
                absImage.includes("localhost")
              }
            />
          </div>
        )}

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {post.content}
        </p>
      </article>
    </div>
  );
}
