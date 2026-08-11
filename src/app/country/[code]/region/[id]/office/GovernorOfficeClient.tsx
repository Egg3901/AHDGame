"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { regionUrl } from "@/lib/urls";
import { resolveRegionOfficeBannerImage } from "@/lib/constants/regionBanner";
import { HeroImage } from "@/components/HeroImage";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { GUBERNATORIAL_ACTION_CAP } from "@/lib/constants/governorOffice";
import ImpeachmentPanel from "@/app/whitehouse/ImpeachmentPanel";
import { OverviewTab } from "./tabs/OverviewTab";
import {
  LegislationTab,
  type AwaitingAssentBill,
  type LegislationActivity,
} from "./tabs/LegislationTab";
import type { EligibleNpp } from "./tabs/legislation/QueueBillModal";
import {
  OrdersTab,
  type ActiveOrder,
  type LegTypeOpt,
  type OrderHistoryEntry,
} from "./tabs/OrdersTab";
import { AddressTab, type MostRecentAddressSummary } from "./tabs/AddressTab";
import { EndorsementsTab, type ActiveEndorsement } from "./tabs/EndorsementsTab";
import { DevolutionTab, type DevolutionDriverSnapshot } from "./tabs/DevolutionTab";
import type { ReferendumPanelData } from "./tabs/devolution/ReferendumPanel";
import type { Race } from "./tabs/endorsements/RaceList";
import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";
import { isUKDevolutionRegion } from "@/lib/constants/devolution";

type TabKey = "overview" | "devolution" | "legislation" | "orders" | "address" | "endorsements";

interface Props {
  countryId: CountryId;
  stateId: string;
  stateName: string;
  stateBannerImage: string | null;
  regionalTitle: string;
  officeHolderName: string | null;
  officeHolderAvatarUrl: string | null;
  officeHolderPartyName: string | null;
  officeHolderPartyAbbreviation: string | null;
  officeHolderPartyColor: string | null;
  viewerIsAdmin: boolean;
  viewerIsHolder: boolean;
  /**
   * Viewer may drive the office's institutional actions (Orders / Legislation /
   * Devolution). True for the human holder, and for an authorized party officer
   * of an NPP-held office. Address / Endorsements stay gated to `viewerIsHolder`.
   */
  viewerCanManage: boolean;
  gubernatorialActions: number;
  lastActionGrantedTurn: number;
  awaitingAssentBills: AwaitingAssentBill[];
  activeOrders: ActiveOrder[];
  orderHistory: OrderHistoryEntry[];
  legislationTypes: LegTypeOpt[];
  currentTurn: number;
  mostRecentAddress: MostRecentAddressSummary | null;
  addressAvailableAtTurn: number;
  activeEndorsements: ActiveEndorsement[];
  availableRaces: Race[];
  legislationActivity: LegislationActivity;
  eligibleNpps: EligibleNpp[];
  /** Devolution tab data — only present for UK SCO/WAL/NIR FM seats. */
  devolution: {
    currentValue: number;
    currentTrend: number;
    currentPolicy: DevolutionPolicy;
    policyChangedAtTurn: number | null;
    proIndyElectionBonus: number;
    driverPreview: DevolutionDriverSnapshot;
    referendum: ReferendumPanelData;
  } | null;
}

function buildTabs(showDevolution: boolean): Array<{ key: TabKey; label: string }> {
  const tabs: Array<{ key: TabKey; label: string }> = [{ key: "overview", label: "Overview" }];
  if (showDevolution) tabs.push({ key: "devolution", label: "Devolution" });
  tabs.push(
    { key: "legislation", label: "Legislation" },
    { key: "orders", label: "Orders" },
    { key: "address", label: "Address" },
    { key: "endorsements", label: "Endorsements" }
  );
  return tabs;
}

export function GovernorOfficeClient(props: Props) {
  const showDevolution =
    props.countryId === COUNTRY_CONFIGS.UK.id &&
    isUKDevolutionRegion(props.stateId) &&
    props.devolution != null;
  const tabs = buildTabs(showDevolution);
  const [active, setActive] = useState<TabKey>("overview");

  // Some regional titles already encode the state name ("Mayor of London")
  // — skip the prefix to avoid "London Mayor of London's Office". Generic
  // titles ("Governor", "First Minister", "Minister-President") still get
  // the "{state} {title}'s Office" form.
  const titleIncludesState = props.regionalTitle
    .toLowerCase()
    .includes(props.stateName.toLowerCase());
  const officePageHeading = titleIncludesState
    ? `${props.regionalTitle}'s Office`
    : `${props.stateName} ${props.regionalTitle}'s Office`;

  const bannerSrc = resolveRegionOfficeBannerImage(
    props.countryId,
    props.stateId,
    props.stateBannerImage
  );

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-12 space-y-8">
        <header className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          {/* Hero banner — same image as the state/region page, dimmed for legibility */}
          <div className="relative h-[140px] w-full sm:h-[180px]">
            {bannerSrc && (
              <HeroImage
                src={bannerSrc}
                alt={props.stateName}
                fill
                className="object-cover object-center"
                sizes="(max-width: 1280px) 100vw, 1280px"
                priority
              />
            )}
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/30"
              aria-hidden
            />
            <div className="absolute inset-0 flex flex-col justify-between px-6 py-5">
              <Link
                href={regionUrl(props.countryId, props.stateId)}
                className="self-start text-xs text-white/80 hover:text-white drop-shadow"
                aria-label={`Back to ${props.stateName}`}
              >
                ← {props.stateName}
              </Link>
              <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl">
                {officePageHeading}
              </h1>
            </div>
          </div>
          {/* Stat bar — office-holder identity + AP */}
          <div className="flex items-center divide-x divide-card-border border-t border-card-border">
            {props.officeHolderName && (
              <div className="flex items-center gap-3 px-5 py-3">
                {props.officeHolderAvatarUrl ? (
                  <Image
                    src={props.officeHolderAvatarUrl}
                    alt={props.officeHolderName}
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-full object-cover shrink-0"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-card-border text-xs text-muted shrink-0">
                    {props.officeHolderName.charAt(0)}
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] uppercase tracking-widest text-muted">
                    {props.regionalTitle}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate">{props.officeHolderName}</span>
                    {props.officeHolderPartyAbbreviation && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                        style={{
                          backgroundColor: props.officeHolderPartyColor ?? "#666",
                        }}
                        title={props.officeHolderPartyName ?? undefined}
                      >
                        {props.officeHolderPartyAbbreviation}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-col px-5 py-3">
              <span className="text-[10px] uppercase tracking-widest text-muted">Office AP</span>
              <span className="text-base font-bold tabular-nums">
                {props.gubernatorialActions}/{GUBERNATORIAL_ACTION_CAP}
              </span>
            </div>
            {props.viewerIsAdmin && !props.viewerIsHolder && (
              <div className="flex flex-col px-5 py-3">
                <span className="text-[10px] uppercase tracking-widest text-muted">Mode</span>
                <span className="text-base font-bold text-primary">Admin view</span>
              </div>
            )}
          </div>
          <nav
            className="flex overflow-x-auto scrollbar-hide border-t border-card-border"
            aria-label="Office sections"
          >
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActive(tab.key)}
                className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm transition-colors ${
                  active === tab.key
                    ? "border-b-2 border-primary text-foreground font-medium"
                    : "text-muted hover:text-foreground"
                }`}
                aria-current={active === tab.key ? "page" : undefined}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </header>

        {props.officeHolderName && (
          <ImpeachmentPanel
            countryId={props.countryId}
            office="governor"
            state={props.stateId}
            targetName={props.officeHolderName}
            isViewerTarget={props.viewerIsHolder}
          />
        )}

        <section>
          {active === "overview" && <OverviewTab {...props} />}
          {active === "devolution" && showDevolution && props.devolution && (
            <DevolutionTab
              countryId={props.countryId}
              stateId={props.stateId}
              stateName={props.stateName}
              currentValue={props.devolution.currentValue}
              currentTrend={props.devolution.currentTrend}
              currentPolicy={props.devolution.currentPolicy}
              policyChangedAtTurn={props.devolution.policyChangedAtTurn}
              currentTurn={props.currentTurn}
              gubernatorialActions={props.gubernatorialActions}
              viewerCanManage={props.viewerCanManage}
              viewerIsAdmin={props.viewerIsAdmin}
              driverPreview={props.devolution.driverPreview}
              proIndyElectionBonus={props.devolution.proIndyElectionBonus}
              referendum={props.devolution.referendum}
            />
          )}
          {active === "legislation" && (
            <LegislationTab
              countryId={props.countryId}
              stateId={props.stateId}
              awaitingAssentBills={props.awaitingAssentBills}
              viewerCanManage={props.viewerCanManage}
              legislationActivity={props.legislationActivity}
              eligibleNpps={props.eligibleNpps}
              legislationTypes={props.legislationTypes}
            />
          )}
          {active === "orders" && (
            <OrdersTab
              countryId={props.countryId}
              stateId={props.stateId}
              activeOrders={props.activeOrders}
              orderHistory={props.orderHistory}
              legislationTypes={props.legislationTypes}
              gubernatorialActions={props.gubernatorialActions}
              viewerCanManage={props.viewerCanManage}
              viewerIsAdmin={props.viewerIsAdmin}
              currentTurn={props.currentTurn}
            />
          )}
          {active === "address" && (
            <AddressTab
              countryId={props.countryId}
              stateId={props.stateId}
              mostRecentAddress={props.mostRecentAddress}
              addressAvailableAtTurn={props.addressAvailableAtTurn}
              currentTurn={props.currentTurn}
              viewerIsHolder={props.viewerIsHolder}
              viewerIsAdmin={props.viewerIsAdmin}
              gubernatorialActions={props.gubernatorialActions}
            />
          )}
          {active === "endorsements" && (
            <EndorsementsTab
              countryId={props.countryId}
              stateId={props.stateId}
              activeEndorsements={props.activeEndorsements}
              availableRaces={props.availableRaces}
              viewerIsHolder={props.viewerIsHolder}
            />
          )}
          {active !== "overview" &&
            active !== "devolution" &&
            active !== "legislation" &&
            active !== "orders" &&
            active !== "address" &&
            active !== "endorsements" && (
              <div className="rounded-xl border border-card-border bg-card p-12 text-center text-muted">
                {tabs.find((t) => t.key === active)?.label} — coming in a later phase.
              </div>
            )}
        </section>
      </main>
    </div>
  );
}
