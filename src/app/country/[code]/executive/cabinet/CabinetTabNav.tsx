"use client";

export type CabinetTabKey = "overview" | "admin";

/**
 * Overview | Admin tab strip for the cabinet pages. The Admin tab follows the
 * red admin-tab convention (StatePageTabs / ExecutiveTabsClient) and only
 * renders when the viewer is an admin.
 */
export function CabinetTabNav({
  active,
  showAdmin,
  onChange,
}: {
  active: CabinetTabKey;
  showAdmin: boolean;
  onChange: (tab: CabinetTabKey) => void;
}) {
  return (
    <nav className="flex overflow-x-auto border-b border-card-border" aria-label="Cabinet sections">
      <button
        onClick={() => onChange("overview")}
        className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm transition-colors ${
          active === "overview"
            ? "border-b-2 border-primary font-medium text-foreground"
            : "text-muted hover:text-foreground"
        }`}
        aria-current={active === "overview" ? "page" : undefined}
      >
        Overview
      </button>
      {showAdmin && (
        <button
          onClick={() => onChange("admin")}
          className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm transition-colors ${
            active === "admin"
              ? "border-b-2 border-error font-medium text-error"
              : "text-error/70 hover:text-error"
          }`}
          aria-current={active === "admin" ? "page" : undefined}
        >
          Admin
        </button>
      )}
    </nav>
  );
}
