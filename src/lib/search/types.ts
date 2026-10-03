export type SearchResultType =
  | "politician"
  | "seat"
  | "region"
  | "election"
  | "corporation"
  | "bill"
  | "page"
  | "commodity"
  | "currency"
  | "bond"
  | "admin";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}
