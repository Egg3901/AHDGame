"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { TargetedAdsPanel } from "@/app/campaign/[id]/components/TargetedAdsPanel";
import { CanvassingPanel } from "@/app/campaign/[id]/components/CanvassingPanel";
import type { Character } from "@/lib/db/types";

export function CampaignActionModal({
  action,
  character,
  onClose,
  onResourcesSpent,
}: {
  action: "canvass" | "targetedAds" | null;
  character: Character;
  onClose: () => void;
  onResourcesSpent: () => void;
}) {
  const t = useTranslations("elections.campaignTargeting");
  return (
    <Modal
      open={action !== null}
      title={t(action === "canvass" ? "canvassTitle" : "title")}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      scrollable
    >
      {action === "targetedAds" && <TargetedAdsPanel onResourcesSpent={onResourcesSpent} />}
      {action === "canvass" && (
        <CanvassingPanel
          countryId={character.countryId}
          characterActions={character.actions}
          characterFunds={character.currencyBalances?.campaign ?? character.funds ?? 0}
          onResourcesSpent={onResourcesSpent}
        />
      )}
    </Modal>
  );
}
