import type { CountryId } from "@/lib/constants/countries";

export const BILL_DISCUSSIONS_PAGE_SIZE = 10;

/** Identifies which bill a discussion thread hangs off of. */
export type BillDiscussionScope =
  | { kind: "national"; countryId: CountryId; billId: string }
  | { kind: "state"; countryId: CountryId; stateId: string; billId: string };

export interface BillDiscussionView {
  _id: string;
  authorId: string;
  authorSequentialId: number | null;
  authorName: string;
  authorAvatarUrl: string | null;
  authorParty: string | null;
  authorPartyColor: string | null;
  authorRegionLabel: string | null;
  authorBorderKey: string | null;
  authorTintColor: string | null;
  content: string;
  reactions: { agree: number; disagree: number };
  viewerReaction: "agree" | "disagree" | null;
  createdAt: string;
}

export interface BillDiscussionListResult {
  posts: BillDiscussionView[];
  page: number;
  totalPages: number;
  total: number;
  viewerCanPost: boolean;
  viewerIsAdmin: boolean;
}
