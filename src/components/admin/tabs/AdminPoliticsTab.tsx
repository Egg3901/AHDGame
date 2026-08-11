"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { OfficialsManager } from "@/components/OfficialsManager";
import { ElectionRestartPanel } from "@/components/admin/elections/ElectionRestartPanel";
import { ElectionLog } from "@/components/ElectionLog";
import { PartyOrgManager } from "@/components/PartyOrgManager";
import { SubTabBar } from "./SubTabBar";
import { SubNavLayout } from "./SubNavLayout";

const PartyElectionsPanel = dynamic(
  () =>
    import("@/components/admin/elections/PartyElectionsPanel").then((m) => ({
      default: m.PartyElectionsPanel,
    })),
  { ssr: false }
);
const LegislationTab = dynamic(
  () =>
    import("@/components/admin/politics/LegislationTab").then((m) => ({
      default: m.LegislationTab,
    })),
  { ssr: false }
);
const ElectionsManageTab = dynamic(
  () =>
    import("@/components/admin/elections/ElectionsManageTab").then((m) => ({
      default: m.ElectionsManageTab,
    })),
  { ssr: false }
);
const LawTypesTab = dynamic(
  () => import("@/components/admin/lawtype/LawTypesTab").then((m) => ({ default: m.LawTypesTab })),
  { ssr: false }
);
export type PoliticsSubTab = "elections" | "parties" | "legislation" | "law-types";

interface AdminPoliticsTabProps {
  activeSub: PoliticsSubTab;
  onSubChange: (sub: PoliticsSubTab) => void;
}

export function AdminPoliticsTab({ activeSub, onSubChange }: AdminPoliticsTabProps) {
  return (
    <SubNavLayout tab="politics" active={activeSub} onChange={onSubChange}>
      <div className="space-y-6">
        {activeSub === "elections" && <ElectionsSubContent />}
        {activeSub === "parties" && <PartiesSubContent />}
        {activeSub === "legislation" && <LegislationTab />}
        {activeSub === "law-types" && <LawTypesTab />}
      </div>
    </SubNavLayout>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="inline-block h-3.5 w-0.5 rounded-full bg-primary flex-shrink-0" />
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">{children}</h2>
    </div>
  );
}

const PrimaryProjectionDebugger = dynamic(
  () =>
    import("@/components/admin/elections/PrimaryProjectionDebugger").then((m) => ({
      default: m.PrimaryProjectionDebugger,
    })),
  { ssr: false }
);

function ElectionsSubContent() {
  const [innerSub, setInnerSub] = useState<"manage" | "primary-debug" | "log">("manage");

  return (
    <div className="space-y-6">
      <SubTabBar
        options={[
          { id: "manage" as const, label: "Manage" },
          { id: "primary-debug" as const, label: "Primary Projection" },
          { id: "log" as const, label: "Election Log" },
        ]}
        active={innerSub}
        onChange={setInnerSub}
      />

      {innerSub === "manage" && (
        <div className="space-y-10">
          <section>
            <SectionLabel>Officials</SectionLabel>
            <OfficialsManager />
          </section>

          <section>
            <SectionLabel>Election Continuity</SectionLabel>
            <ElectionRestartPanel />
          </section>

          <section>
            <SectionLabel>Timers & Schedule</SectionLabel>
            <ElectionsManageTab />
          </section>
        </div>
      )}

      {innerSub === "primary-debug" && (
        <div className="space-y-6">
          <section>
            <SectionLabel>Presidential Primary Projection</SectionLabel>
            <PrimaryProjectionDebugger />
          </section>
        </div>
      )}

      {innerSub === "log" && <ElectionLog />}
    </div>
  );
}

function PartiesSubContent() {
  const [innerSub, setInnerSub] = useState<"org" | "elections">("org");

  return (
    <div className="space-y-6">
      <SubTabBar
        options={[
          { id: "org" as const, label: "Organization" },
          { id: "elections" as const, label: "Leadership Elections" },
        ]}
        active={innerSub}
        onChange={setInnerSub}
      />

      {innerSub === "org" && <PartyOrgManager />}
      {innerSub === "elections" && <PartyElectionsPanel />}
    </div>
  );
}
