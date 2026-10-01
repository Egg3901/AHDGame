import type { Metadata } from "next";
import { SearchResultsClient } from "./SearchResultsClient";

export const metadata: Metadata = {
  title: "Search | A House Divided",
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const initialQuery = typeof q === "string" ? q : "";

  return <SearchResultsClient key={initialQuery} initialQuery={initialQuery} />;
}
