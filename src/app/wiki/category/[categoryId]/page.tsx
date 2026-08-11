// src/app/wiki/category/[categoryId]/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategoryBySlug } from "@/lib/wiki/categories";
import { getAllWikiPagesForDisplay } from "@/lib/wiki/getWikiPageData";
import { wikiPublicPageMetadata } from "@/lib/siteMetadata";

interface CategoryPageProps {
  params: Promise<{ categoryId: string }>;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { categoryId } = await params;
  const category = getCategoryBySlug(categoryId);
  if (!category) return { title: "Category Not Found", robots: { index: false, follow: false } };
  return wikiPublicPageMetadata({
    title: `${category.name} | Wiki | A House Divided`,
    description: `${category.description}. Browse the official A House Divided wiki pages in this section.`,
    pathname: `/wiki/category/${category.slug}`,
  });
}

const DIFFICULTY_LABELS = {
  beginner: { label: "Beginner", className: "text-success" },
  intermediate: { label: "Intermediate", className: "text-warning" },
  advanced: { label: "Advanced", className: "text-error" },
} as const;

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { categoryId } = await params;
  const category = getCategoryBySlug(categoryId);
  if (!category) notFound();

  const allPages = await getAllWikiPagesForDisplay();
  const categoryPages =
    categoryId === "custom-pages"
      ? allPages.filter((p) => p.isCustomPage)
      : allPages.filter((p) => p.category === categoryId);

  return (
    <div className="mx-auto max-w-4xl min-w-0 overflow-x-hidden px-4 py-8">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/wiki" className="hover:text-foreground transition-colors">
          Wiki
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground">{category.name}</span>
      </nav>

      <div className="mb-8">
        <p className="section-label mb-3">Category</p>
        <h1 className="mb-2 font-serif text-3xl font-bold text-foreground">{category.name}</h1>
        <p className="text-lg text-muted">{category.description}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {categoryPages.map((page) => {
          const diff = page.difficulty ? DIFFICULTY_LABELS[page.difficulty] : null;
          return (
            <Link
              key={page.slug}
              href={`/wiki/${page.slug}`}
              className="group flex flex-col rounded-xl border border-card-border bg-card/40 p-4 transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-card/60 hover:shadow-md"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-foreground transition-colors group-hover:text-primary">
                  {page.title}
                </span>
                {diff && (
                  <span
                    className={`shrink-0 font-mono text-xs font-semibold uppercase tracking-[0.08em] ${diff.className}`}
                  >
                    {diff.label}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted">{page.description}</p>
            </Link>
          );
        })}
      </div>

      {categoryPages.length === 0 && (
        <p className="text-center text-muted">No pages in this category yet.</p>
      )}
    </div>
  );
}
