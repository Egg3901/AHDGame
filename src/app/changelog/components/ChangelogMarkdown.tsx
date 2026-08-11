"use client";

import Link from "next/link";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChangelogChart, parseChartSpec } from "./ChangelogChart";

/**
 * Markdown renderer for changelog posts.
 *
 * Two authoring extensions beyond plain markdown, both used by the dev-diary
 * posts:
 *
 *   ![Caption text](/changelog/1.0.0/turn-timings.png)
 *     -> a figure with the alt text rendered as a visible caption.
 *
 *   ```chart
 *   { "type": "bar", "title": "...", "categories": [...], "series": [...] }
 *   ```
 *     -> an inline SVG chart. See ChangelogChart for the spec.
 *
 * `compact` renders the tighter type used inside feed cards; the full post page
 * uses the roomier default so a long read does not feel cramped.
 */

interface ChangelogMarkdownProps {
  content: string;
  compact?: boolean;
}

/** Pull the raw text out of a fenced code block's children. */
function codeText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(codeText).join("");
  return "";
}

function ChartFence({ raw }: { raw: string }) {
  const result = parseChartSpec(raw);
  if ("error" in result) {
    // Surface authoring mistakes in place rather than rendering nothing — a
    // silently missing chart is much harder to notice in review than this.
    return (
      <div className="my-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
        Chart could not be rendered: {result.error}
      </div>
    );
  }
  return <ChangelogChart spec={result.spec} />;
}

export function ChangelogMarkdown({ content, compact = false }: ChangelogMarkdownProps) {
  const body = compact ? "text-sm" : "text-[15px]";
  const lead = compact ? "leading-relaxed" : "leading-7";

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith("/")) {
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
        h2: ({ children }) =>
          compact ? (
            <h3 className="mb-2 mt-4 text-sm font-bold uppercase tracking-wider text-foreground/80 first:mt-0">
              {children}
            </h3>
          ) : (
            <h2 className="mb-3 mt-10 border-b border-card-border pb-2 text-xl font-bold tracking-tight text-foreground first:mt-0">
              {children}
            </h2>
          ),
        h3: ({ children }) =>
          compact ? (
            <h4 className="mb-1.5 mt-3 text-sm font-semibold text-foreground">{children}</h4>
          ) : (
            <h3 className="mb-2 mt-7 text-base font-semibold text-foreground">{children}</h3>
          ),
        p: ({ children }) => (
          <p className={`${body} ${lead} text-muted [&:not(:last-child)]:mb-4`}>{children}</p>
        ),
        ul: ({ children }) => <ul className="mb-4 space-y-2 pl-1">{children}</ul>,
        ol: ({ children }) => (
          <ol className="mb-4 list-decimal space-y-2 pl-5 marker:text-muted">{children}</ol>
        ),
        li: ({ children }) => (
          <li className={`${body} ${lead} text-muted`}>
            <span className="mr-1.5 text-card-border">&#x2022;</span>
            <span className="inline [&>p]:inline">{children}</span>
          </li>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-5 border-l-2 border-primary/40 bg-card-elevated/30 py-2 pl-4 pr-3 italic text-muted [&>p]:mb-0">
            {children}
          </blockquote>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),
        hr: () => <hr className="my-8 border-card-border" />,
        table: ({ children }) => (
          <div className="my-5 overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-card-border px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-b border-card-border/40 px-2 py-1.5 text-sm text-muted">
            {children}
          </td>
        ),
        img: ({ src, alt }) => {
          if (typeof src !== "string" || !src) return null;
          return (
            <figure className="my-6 not-prose">
              <div className="overflow-hidden rounded-xl border border-card-border bg-card">
                {/* Post images are arbitrary author-supplied assets with no
                    build-time dimensions. Give next/image a nominal intrinsic
                    size and let CSS restore the real aspect ratio. */}
                <Image
                  src={src}
                  alt={alt ?? ""}
                  width={1600}
                  height={900}
                  sizes="(max-width: 768px) 100vw, 720px"
                  className="h-auto w-full"
                />
              </div>
              {alt && (
                <figcaption className="mt-2 text-xs leading-relaxed text-muted">{alt}</figcaption>
              )}
            </figure>
          );
        },
        code: (props) => {
          const { className, children } = props as {
            className?: string;
            children?: React.ReactNode;
          };
          if (className === "language-chart") {
            return <ChartFence raw={codeText(children)} />;
          }
          if (className?.startsWith("language-")) {
            return (
              <code className="block overflow-x-auto rounded-lg bg-zinc-900 p-3 font-mono text-xs leading-relaxed text-emerald-400">
                {children}
              </code>
            );
          }
          return (
            <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-emerald-400">
              {children}
            </code>
          );
        },
        // ReactMarkdown wraps fenced code in <pre>; a chart replaces the whole
        // block, so let the child own its container instead of nesting a figure
        // inside a <pre> (invalid HTML, and it inherits monospace styling).
        pre: ({ children }) => <>{children}</>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
