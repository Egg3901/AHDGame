"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpRight, LoaderCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import type { SearchResult, SearchResultType } from "@/lib/search/types";

const TYPE_LABEL_KEY: Record<SearchResultType, string> = {
  politician: "search.types.politician",
  corporation: "search.types.corporation",
  seat: "search.types.seat",
  region: "search.types.region",
  election: "search.types.election",
  bill: "search.types.bill",
  page: "search.types.page",
  commodity: "search.types.commodity",
  currency: "search.types.currency",
  bond: "search.types.bond",
  admin: "search.types.admin",
};

export function SearchResultsClient({ initialQuery }: { initialQuery: string }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(
    initialQuery.trim().length >= 2 && initialQuery.trim().length <= 200
  );
  const [error, setError] = useState<"unavailable" | "tooLong" | null>(
    initialQuery.trim().length > 200 ? "tooLong" : null
  );
  const [requestVersion, setRequestVersion] = useState(0);

  const submittedQuery = initialQuery.trim();

  useEffect(() => {
    if (submittedQuery.length < 2 || submittedQuery.length > 200) return;

    const controller = new AbortController();

    fetch(`/api/search/universal?q=${encodeURIComponent(submittedQuery)}&view=page`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Search request failed");
        return (await response.json()) as { results?: SearchResult[] };
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setResults(Array.isArray(data.results) ? data.results : []);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResults([]);
          setError("unavailable");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [submittedQuery, requestVersion]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = query.trim();
    if (!nextQuery) return;
    if (nextQuery === submittedQuery && nextQuery.length >= 2 && nextQuery.length <= 200) {
      setLoading(true);
      setError(null);
      setRequestVersion((version) => version + 1);
      return;
    }
    router.push(`/search?q=${encodeURIComponent(nextQuery)}`);
  };

  const showResults = submittedQuery.length >= 2 && submittedQuery.length <= 200;

  return (
    <main className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-9">
        <header className="relative isolate overflow-hidden rounded-2xl border border-card-border bg-card shadow-panel">
          <div className="relative px-5 py-7 sm:px-8 sm:py-9">
            <div className="mb-3 flex items-center gap-2 text-[length:var(--text-body-sm)] font-semibold uppercase tracking-[0.16em] text-primary">
              {t("search.eyebrow")}
            </div>
            <h1 className="font-serif text-[length:var(--text-display)] font-bold tracking-tight text-foreground">
              {t("search.pageTitle")}
            </h1>
            <p className="mt-2 max-w-2xl text-[length:var(--text-body)] leading-relaxed text-muted sm:text-[length:var(--text-body-lg)]">
              {t("search.pageDescription")}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-2 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  maxLength={200}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("search.placeholder")}
                  aria-label={t("search.ariaLabel")}
                  className="min-h-12 w-full rounded-xl border border-card-border bg-background/80 py-3 pl-12 pr-4 text-[length:var(--text-body-lg)] text-foreground shadow-card outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <Button
                type="submit"
                size="lg"
                disabled={!query.trim()}
                className="min-h-12 gap-2 rounded-xl px-5 py-3 text-[length:var(--text-body)] shadow-card focus-visible:ring-offset-card disabled:cursor-not-allowed"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                {t("search.submit")}
              </Button>
            </form>
          </div>
        </header>

        <section aria-label={t("search.resultsRegion")} aria-live="polite">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <p className="text-[length:var(--text-body-sm)] font-semibold uppercase tracking-[0.14em] text-muted">
                {t("search.topMatches")}
              </p>
              <h2 className="mt-1 break-words text-[length:var(--text-heading)] font-semibold text-foreground sm:text-[length:var(--text-heading-lg)]">
                {showResults
                  ? t("search.resultsFor", { query: submittedQuery })
                  : t("search.readyTitle")}
              </h2>
            </div>
            {showResults && !loading && !error && (
              <span className="rounded-full border border-card-border bg-card px-3 py-1 text-[length:var(--text-body-sm)] font-medium text-muted shadow-card">
                {t("search.resultCount", { count: results.length })}
              </span>
            )}
          </div>

          {loading && (
            <div className="space-y-3" role="status" aria-label={t("search.searching")}>
              <p className="flex items-center gap-2 px-1 text-[length:var(--text-body)] text-muted">
                <LoaderCircle className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                {t("search.searching")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[0, 1, 2, 3].map((item) => (
                  <Skeleton key={item} className="h-24 rounded-xl border border-card-border" />
                ))}
              </div>
            </div>
          )}

          {!loading && error && (
            <SearchNotice
              title={t("search.errorTitle")}
              description={t(error === "tooLong" ? "search.queryTooLong" : "search.searchError")}
            />
          )}

          {!loading && !error && !showResults && (
            <SearchNotice
              title={t("search.readyTitle")}
              description={
                submittedQuery.length === 0
                  ? t("search.emptyQueryDescription")
                  : t("search.minimumQuery")
              }
            />
          )}

          {!loading && !error && showResults && results.length === 0 && (
            <SearchNotice
              title={t("search.noResultsTitle")}
              description={t("search.noResultsDescription", { query: submittedQuery })}
            />
          )}

          {!loading && !error && results.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {results.map((result) => (
                <li key={`${result.type}-${result.id}`} className="min-w-0">
                  <Link
                    href={result.href}
                    className="group flex h-full min-h-24 items-center gap-3 rounded-xl border border-card-border bg-card p-4 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="mb-1 flex min-w-0 items-center gap-2">
                        <span className="truncate text-[length:var(--text-body-lg)] font-semibold text-foreground transition-colors group-hover:text-primary">
                          {result.title}
                        </span>
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[length:var(--text-body-xs)] font-semibold uppercase tracking-wide text-primary">
                          {t(TYPE_LABEL_KEY[result.type])}
                        </span>
                      </span>
                      <span className="block truncate text-[length:var(--text-body)] text-muted">
                        {result.subtitle}
                      </span>
                    </span>
                    <ArrowUpRight
                      className="h-4 w-4 shrink-0 text-muted transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function SearchNotice({ title, description }: { title: string; description: string }) {
  return (
    <Card
      variant="dashed"
      padding="none"
      className="rounded-2xl bg-card/60 px-6 py-10 text-center shadow-card sm:px-10"
    >
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-card-border bg-card-elevated text-primary shadow-card">
        <Search className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-[length:var(--text-heading-sm)] font-semibold text-foreground">
        {title}
      </h3>
      <p className="mx-auto mt-1 max-w-lg text-[length:var(--text-body)] leading-relaxed text-muted">
        {description}
      </p>
    </Card>
  );
}
