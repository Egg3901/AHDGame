"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CampaignData } from "@/lib/campaigns/dto/campaignView";

interface ActivityLogProps {
  activityHistory: NonNullable<CampaignData["activityHistory"]>;
  currencyCode: CurrencyCode;
}

export function ActivityLog({ activityHistory, currencyCode }: ActivityLogProps) {
  // activity.costFunds is recorded in the campaign's local currency; face-format
  // it (useCurrency().formatFull would convert anchor→local → double-count).
  const formatFull = (value: number) => formatCurrencyFaceAmount(value, currencyCode);
  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h2 className="text-lg font-semibold mb-4">Activity Log</h2>
      <div className="space-y-2">
        {activityHistory
          .slice()
          .reverse()
          .map((activity, idx) => {
            const isSuspendEndorse = activity.type === "suspend_endorse";
            const isDowngrade = activity.type === "downgrade";
            const reasonLabel =
              activity.reason === "insolvency"
                ? "auto-downgraded (couldn't afford maintenance)"
                : activity.reason === "migration"
                  ? "auto-downgraded (legacy balance cleanup)"
                  : activity.reason === "reset"
                    ? "manual reset"
                    : null;
            return (
              <div
                key={idx}
                className="flex items-center justify-between py-2 px-3 rounded-lg border border-card-border bg-background text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Tooltip content={`Turn ${activity.turnNumber}`}>
                    <span className="font-mono text-xs text-muted tabular-nums cursor-help shrink-0">
                      T{activity.turnNumber}
                    </span>
                  </Tooltip>
                  <div className="truncate">
                    {isSuspendEndorse ? (
                      <>
                        <span className="font-medium text-warning">Suspended campaign</span>
                        {activity.targetName && (
                          <>
                            <span className="text-muted"> — endorsed </span>
                            <span className="font-medium text-foreground">
                              {activity.targetName}
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="font-medium">
                          {(activity.category ?? "").replace(/([A-Z])/g, " $1").trim()}
                        </span>
                        <span className="text-muted">{isDowngrade ? " down to " : " to "}</span>
                        <span
                          className={`font-medium ${isDowngrade ? "text-warning" : "text-info"}`}
                        >
                          Lv {activity.newLevel ?? 0}
                        </span>
                        {activity.targetName && (
                          <>
                            <span className="text-muted"> vs </span>
                            <span className="text-error font-medium">{activity.targetName}</span>
                          </>
                        )}
                      </>
                    )}
                    {reasonLabel && (
                      <span className="text-muted text-xs ml-2">— {reasonLabel}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 font-mono text-xs text-muted shrink-0 ml-2">
                  {isSuspendEndorse ? (
                    <span className="text-warning">suspended</span>
                  ) : isDowngrade ? (
                    <span className="text-warning">demoted</span>
                  ) : (
                    <>
                      <span>-{formatFull(activity.costFunds ?? 0)}</span>
                      <span>-{activity.costActions ?? 0}a</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
