"use client";

import { Modal } from "@/components/ui";

interface SuggestionSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mutedTypes: string[];
  onMuteToggle: (type: string) => void;
}

const SUGGESTION_CATEGORIES = [
  {
    id: "stat-recovery",
    label: "Stat Recovery",
    description: "Low actions, funds, influence, favorability",
  },
  {
    id: "resource-opt",
    label: "Resource Optimization",
    description: "Action hoarding, cash conversion",
  },
  {
    id: "market-opportunity",
    label: "Market Opportunities",
    description: "Unowned sector splits, national expansion",
  },
  { id: "competitive", label: "Competitive", description: "Low market share vs competitors" },
  { id: "party", label: "Party", description: "GOTV, org building, vacant positions" },
  { id: "cosmetic", label: "Cosmetic", description: "Profile pictures, header images, logos" },
];

export function SuggestionSettingsModal({
  isOpen,
  onClose,
  mutedTypes,
  onMuteToggle,
}: SuggestionSettingsModalProps) {
  return (
    <Modal open={isOpen} title="Suggestion Settings" onClose={onClose}>
      <p className="text-sm text-muted mb-4">
        Mute suggestion categories you don&apos;t want to see. Muted suggestions won&apos;t appear
        in your dashboard or indicator strip.
      </p>

      <div className="space-y-3">
        {SUGGESTION_CATEGORIES.map((category) => {
          const isMuted = mutedTypes.includes(category.id);
          return (
            <div
              key={category.id}
              className="flex items-start justify-between rounded-lg border border-card-border p-3"
            >
              <div className="flex-1">
                <div className="font-medium text-foreground">{category.label}</div>
                <div className="text-xs text-muted mt-0.5">{category.description}</div>
              </div>
              <button
                onClick={() => onMuteToggle(category.id)}
                className={`ml-3 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  isMuted
                    ? "bg-warning/20 text-warning hover:bg-warning/30"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {isMuted ? "Muted" : "Mute"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
