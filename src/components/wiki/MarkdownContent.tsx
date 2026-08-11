"use client";

import Link from "next/link";
import { Children, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getWikiComponent } from "@/lib/wiki/componentRegistry";

const WIKI_LINK = /^\/wiki\//;

// Only allow images from http(s), protocol-relative, or same-origin absolute paths.
// react-markdown already blocks javascript: URLs, but keep an explicit allow-list.
function isSafeImageSrc(src: string | undefined): src is string {
  if (!src) return false;
  if (src.startsWith("/") || src.startsWith("//")) return true;
  try {
    const u = new URL(src);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

function toAnchorId(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function MarkdownContent({ content }: { content: string; headings?: TocHeading[] }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          if (href && (href.startsWith("/") || WIKI_LINK.test(href))) {
            return (
              <Link href={href} className="text-primary hover:underline">
                {children}
              </Link>
            );
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {children}
            </a>
          );
        },
        h1: ({ children }) => (
          <h1 className="mb-4 mt-8 border-b border-card-border pb-2 text-2xl font-bold text-foreground first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => {
          const text =
            typeof children === "string"
              ? children
              : Array.isArray(children)
                ? children.join("")
                : String(children);
          const id = toAnchorId(text);
          return (
            <h2 id={id} className="mb-3 mt-6 scroll-mt-24 text-xl font-semibold text-foreground">
              {children}
            </h2>
          );
        },
        h3: ({ children }) => {
          const text =
            typeof children === "string"
              ? children
              : Array.isArray(children)
                ? children.join("")
                : String(children);
          const id = toAnchorId(text);
          return (
            <h3 id={id} className="mb-2 mt-4 scroll-mt-24 text-lg font-medium text-foreground">
              {children}
            </h3>
          );
        },
        p: ({ children }) => <p className="mb-3 leading-relaxed text-muted">{children}</p>,
        ul: ({ children }) => (
          <ul className="mb-4 ml-6 list-disc space-y-1 text-muted">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-4 ml-6 list-decimal space-y-1 text-muted">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        table: ({ children }) => (
          <div className="mb-6 overflow-x-auto rounded-lg border border-card-border">
            <table className="w-full min-w-[400px] border-collapse text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-card-elevated">{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr className="border-b border-card-border last:border-b-0">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="px-4 py-3 text-left font-medium text-foreground">{children}</th>
        ),
        td: ({ children }) => <td className="px-4 py-3 text-muted">{children}</td>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-primary/50 bg-card/50 py-1 pl-4 italic text-muted">
            {children}
          </blockquote>
        ),
        pre: ({ children }) => {
          const child = Children.toArray(children)[0];
          if (Children.count(children) === 1 && isValidElement(child) && child.type !== "code") {
            return <>{children}</>;
          }
          return (
            <pre className="mb-4 overflow-x-auto rounded-lg border border-card-border bg-card-elevated p-4 text-sm">
              {children}
            </pre>
          );
        },
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            const lang = className?.replace("language-", "").trim();
            const WikiComponent = lang ? getWikiComponent(lang) : null;
            if (WikiComponent) {
              // Code-fence body is passed through as the widget's `data` prop.
              // Widgets that need a parameter (e.g. commodity type) parse it;
              // parameterless widgets ignore it.
              const rawData = String(children ?? "").trim();
              return <WikiComponent data={rawData} />;
            }
            return (
              <code className="text-foreground" {...props}>
                {children}
              </code>
            );
          }
          return (
            <code
              className="rounded bg-card-elevated px-1.5 py-0.5 font-mono text-sm text-foreground"
              {...props}
            >
              {children}
            </code>
          );
        },
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),
        img: ({ src, alt, title }) => {
          if (!isSafeImageSrc(typeof src === "string" ? src : undefined)) return null;
          return (
            /* eslint-disable-next-line @next/next/no-img-element -- user content URLs aren't known at build time; next/image requires configured domains */
            <img
              src={src as string}
              alt={alt ?? ""}
              title={title}
              loading="lazy"
              className="my-4 max-w-full h-auto rounded-lg border border-card-border"
            />
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
