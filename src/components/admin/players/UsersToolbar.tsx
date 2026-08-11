"use client";

interface UsersToolbarProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  showDuplicatesOnly: boolean;
  onToggleDuplicatesOnly: () => void;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  totalUsers: number;
  filteredCount: number;
  duplicateGroupCount: number;
  duplicateCount: number;
}

export function UsersToolbar({
  searchTerm,
  onSearchTermChange,
  showDuplicatesOnly,
  onToggleDuplicatesOnly,
  loading,
  error,
  onRefresh,
  totalUsers,
  filteredCount,
  duplicateGroupCount,
  duplicateCount,
}: UsersToolbarProps) {
  return (
    <>
      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.target.value)}
          placeholder="Search users by name, email, or character..."
          className="flex-1 rounded-lg border border-card-border bg-background px-4 py-2.5 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleDuplicatesOnly}
            disabled={loading}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              showDuplicatesOnly
                ? "bg-amber-500 text-black hover:bg-amber-400"
                : "border border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            }`}
          >
            {showDuplicatesOnly && (
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            {showDuplicatesOnly
              ? `Showing ${duplicateGroupCount} Groups (${duplicateCount} accounts)`
              : `⚠ Show Duplicates${duplicateGroupCount > 0 ? ` (${duplicateGroupCount})` : ""}`}
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {!loading && !error && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-card-border bg-card px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted">Total Users:</span>
            <span className="font-semibold tabular-nums">{totalUsers}</span>
          </div>
          {(searchTerm || showDuplicatesOnly) && (
            <>
              <div className="h-4 w-px bg-card-border" />
              <div className="flex items-center gap-2">
                <span className="text-muted">Showing:</span>
                <span className="font-semibold tabular-nums">{filteredCount}</span>
              </div>
            </>
          )}
          {duplicateCount > 0 && (
            <>
              <div className="h-4 w-px bg-card-border" />
              <div className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 text-amber-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span className="text-amber-400 font-medium">
                  {duplicateGroupCount} duplicate groups ({duplicateCount} accounts)
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {error && <div className="rounded-lg bg-red-500/20 p-4 text-red-400">{error}</div>}
      {loading && !error && (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center text-muted shadow-sm">
          Loading users...
        </div>
      )}
    </>
  );
}
