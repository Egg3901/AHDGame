"use client";

import Link from "next/link";
import { SetupPanel } from "@/components/admin/system/SetupPanel";

/** One follow-up step that lives elsewhere in the panel — deep-linked rather
 * than duplicated here. */
interface ChecklistStep {
  title: string;
  desc: string;
  href: string;
  linkLabel: string;
}

const FOLLOW_UP_STEPS: ChecklistStep[] = [
  {
    title: "Verify country readiness",
    desc: "Confirm every enabled country's reference data seeded cleanly for the chosen preset.",
    href: "/admin?tab=system&sub=seed",
    linkLabel: "Seed Database",
  },
  {
    title: "Bootstrap remaining countries",
    desc: "Run the universal seeder for any country whose runtime state (regions, demographics, NPPs, seats, economy) still needs building.",
    href: "/admin?tab=system&sub=universal-seeder",
    linkLabel: "Universal Seeder",
  },
  {
    title: "Spawn missing elections",
    desc: "Scan all states and fill any races that should exist but aren't running — plus per-country spawners (UK, JP, DE, CN, BR, IE).",
    href: "/admin?tab=politics&sub=elections",
    linkLabel: "Politics · Elections",
  },
  {
    title: "Seed unowned sectors",
    desc: "Populate sector slots so the corporate economy has something to run on (auto re-seed only covers gates left on).",
    href: "/admin?tab=economy&sub=sector-seed",
    linkLabel: "Economy · Sector Seed",
  },
  {
    title: "Review kill switches & feature gates",
    desc: "Registration, random events, transfers, and gates carry over — make sure the world posture matches the new iteration.",
    href: "/admin?tab=dashboard",
    linkLabel: "Dashboard",
  },
  {
    title: "Set the iteration & resume the cron",
    desc: "Stamp the new Alpha/Beta number if you didn't during reset, run a manual turn to smoke-test, then start the clock.",
    href: "/admin?tab=dashboard",
    linkLabel: "Turn Controls",
  },
];

/** Everything an admin runs after a world reset, in order, in one place —
 * replaces hunting across the old standalone /admin/setup screen and
 * scattered panel sections. Step 1 embeds the setup/readiness panel itself
 * (reference data, elected officials, IMF institution corporation). */
export function PostResetChecklist() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Post Reset Checklist</h2>
        <p className="mt-1 text-sm text-muted">
          Run these top to bottom after a world reset. Step 1 (server setup, readiness checks, and
          the IMF institution corporation) runs right here; the follow-up steps deep-link to their
          tools.
        </p>
      </div>

      {/* Step 1 — setup + readiness + IMF seed, embedded (same panel the
          standalone /admin/setup screen uses). */}
      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <StepBadge n={1} />
          <div>
            <p className="text-sm font-semibold">Server setup, readiness &amp; IMF institution</p>
            <p className="text-xs text-muted">
              Idempotent reference-data seed, elected officials, cycle-1 elections, and the IMF
              corporation required for bailout tools.
            </p>
          </div>
        </div>
        <SetupPanel />
      </div>

      {/* Follow-up steps living elsewhere in the panel */}
      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <div className="flex flex-col divide-y divide-card-border/60">
          {FOLLOW_UP_STEPS.map((step, i) => (
            <div key={step.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <StepBadge n={i + 2} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.desc}</p>
              </div>
              <Link
                href={step.href}
                className="shrink-0 rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                {step.linkLabel} →
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
      {n}
    </span>
  );
}
