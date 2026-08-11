"use client";

import { useState, type ReactNode } from "react";
import { WhiteHouseAddressTab } from "@/app/whitehouse/WhiteHouseAddressTab";
import { WhiteHouseOrdersTab } from "@/app/whitehouse/WhiteHouseOrdersTab";
import { WhiteHouseEndorsementsTab } from "@/app/whitehouse/WhiteHouseEndorsementsTab";
import { RegimeHealthTab } from "./RegimeHealthTab";
import { AdminRegimePanel } from "@/app/admin/country/[code]/regime/AdminRegimePanel";
import { AdminAppointPmButton } from "./components/AdminAppointPmModal";
import {
  COUNTRY_CONFIGS,
  getExecutiveOrderNamePlural,
  type CountryId,
} from "@/lib/constants/countries";
import { ExecutiveActivitySection } from "./components/ExecutiveActivitySection";
import { ForeignAffairsTab } from "./components/ForeignAffairsTab";
import { useConflictsEnabled } from "@/contexts/AuthDataContext";

type TabKey = "overview" | "address" | "orders" | "endorsements" | "regime" | "foreign" | "admin";

interface Props {
  countryId: CountryId;
  /** Server-rendered overview body — the existing executive hub content. */
  overview: ReactNode;
  /** Whether the viewer is the sitting head of government (PM / Chancellor). */
  viewerIsLeader: boolean;
  viewerIsAdmin: boolean;
  /**
   * Whether to show the Regime Health tab — gated on the country being
   * a one-party state at runtime. Computed server-side so a post-Stage-4
   * conversion immediately hides the tab.
   */
  isOnePartyState?: boolean;
}

/**
 * Tab shell for UK / DE / JP executive pages. The hub layout (hero, status
 * strip) wraps this; this owns the tab nav and body switcher. Overview tab
 * body is the pre-existing hub content passed as `overview`. Address and
 * Orders tabs mount the federal components with national scope, visible
 * only to the sitting leader or an admin. The orders tab is labelled per
 * country — "Order in Council" for parliamentary systems.
 */
export function ExecutiveTabsClient({
  countryId,
  overview,
  viewerIsLeader,
  viewerIsAdmin,
  isOnePartyState,
}: Props) {
  const [active, setActive] = useState<TabKey>("overview");
  const canSeePrivateTabs = viewerIsLeader || viewerIsAdmin;
  const conflictsEnabled = useConflictsEnabled();
  const ordersLabel = getExecutiveOrderNamePlural(countryId);

  return (
    <>
      {/* Scrolls horizontally on a narrow screen. A one-party-state leader with
          conflicts enabled sees seven tabs, and without this the last of them —
          Foreign Affairs and Regime Health — sat off the edge of a phone with no
          way to reach them. */}
      <nav
        className="mb-6 flex min-w-0 overflow-x-auto border-b border-card-border"
        aria-label="Executive sections"
      >
        <TabButton active={active === "overview"} onClick={() => setActive("overview")}>
          Overview
        </TabButton>
        {canSeePrivateTabs && (
          <TabButton active={active === "address"} onClick={() => setActive("address")}>
            Address
          </TabButton>
        )}
        {canSeePrivateTabs && (
          <TabButton active={active === "orders"} onClick={() => setActive("orders")}>
            {ordersLabel}
          </TabButton>
        )}
        {canSeePrivateTabs && (
          <TabButton active={active === "endorsements"} onClick={() => setActive("endorsements")}>
            Endorsements
          </TabButton>
        )}
        {canSeePrivateTabs && conflictsEnabled && (
          <TabButton active={active === "foreign"} onClick={() => setActive("foreign")}>
            Foreign Affairs
          </TabButton>
        )}
        {canSeePrivateTabs && isOnePartyState && (
          <TabButton active={active === "regime"} onClick={() => setActive("regime")}>
            Regime Health
          </TabButton>
        )}
        {viewerIsAdmin && (
          <TabButton active={active === "admin"} onClick={() => setActive("admin")} variant="admin">
            Admin
          </TabButton>
        )}
      </nav>
      {active === "overview" && (
        <div className="space-y-8">
          {overview}
          {/* X instruments + acts ledger + cabinet roster (locked composite) —
              rendered below the hub's leadership grid so the page reads
              leadership → instruments → acts + roster, the same macro order as
              the US White House overview. */}
          <ExecutiveActivitySection
            countryId={countryId}
            cabinetSource="parliamentary"
            ledgerFooter={{
              href: COUNTRY_CONFIGS[countryId].legislature.path,
              label: `${COUNTRY_CONFIGS[countryId].legislature.name} page`,
            }}
          />
        </div>
      )}
      {active === "address" && <WhiteHouseAddressTab countryId={countryId} />}
      {active === "orders" && <WhiteHouseOrdersTab countryId={countryId} />}
      {active === "endorsements" && <WhiteHouseEndorsementsTab countryId={countryId} />}
      {/* Guards repeated on the BODY, not just the button: `active` is component
          state, so a flag flipping off while this tab is open would otherwise leave
          it rendered. */}
      {active === "foreign" && canSeePrivateTabs && conflictsEnabled && (
        <ForeignAffairsTab countryId={countryId} canAct={canSeePrivateTabs} />
      )}
      {active === "regime" && isOnePartyState && <RegimeHealthTab countryCode={countryId} />}
      {active === "admin" && viewerIsAdmin && (
        <div data-testid="executive-admin-tab" className="space-y-8">
          <section data-testid="executive-admin-appoint">
            <div className="mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
                Executive Appointment
              </h2>
              <p className="mt-1 text-xs text-muted">
                Admin override: directly appoint or vacate the head of government, bypassing the
                chamber vote.
              </p>
            </div>
            <AdminAppointPmButton countryId={countryId} />
          </section>
          {isOnePartyState && (
            <div data-testid="executive-admin-regime">
              <AdminRegimePanel countryCode={countryId} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
  variant,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** "admin" colors the tab red to match the StatePageTabs admin convention. */
  variant?: "admin";
}) {
  let className: string;
  if (variant === "admin") {
    className = active
      ? "border-b-2 border-error text-error font-medium"
      : "text-error/70 hover:text-error";
  } else {
    className = active
      ? "border-b-2 border-primary text-foreground font-medium"
      : "text-muted hover:text-foreground";
  }
  return (
    <button
      onClick={onClick}
      // shrink-0 + nowrap so the strip scrolls instead of squeezing the labels
      // into unreadable slivers on a phone.
      className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm transition-colors ${className}`}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </button>
  );
}
