"use client";

export const FUND_PAGE_SIZE = 10;
export function FundPagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / FUND_PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <nav
      aria-label="Fund list pagination"
      className="flex items-center justify-between gap-3 border-t border-card-border px-4 py-3 text-sm"
    >
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded border border-card-border px-3 py-1 disabled:opacity-40"
      >
        Previous
      </button>
      <span aria-live="polite">
        {page} / {pages} ({total} total)
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
        className="rounded border border-card-border px-3 py-1 disabled:opacity-40"
      >
        Next
      </button>
    </nav>
  );
}
