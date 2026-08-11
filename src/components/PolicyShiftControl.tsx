"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";

interface PolicyShiftControlProps {
  axis: "economic" | "social";
  value: number;
  onShift: (axis: "economic" | "social", direction: -1 | 1) => Promise<void>;
  currentActions: number;
}

export function PolicyShiftControl({
  axis,
  value,
  onShift,
  currentActions,
}: PolicyShiftControlProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState<{ direction: -1 | 1 } | null>(null);

  const leftLabel = axis === "economic" ? "Progressive" : "Liberal";
  const rightLabel = axis === "economic" ? "Conservative" : "Traditional";
  const ACTION_COST = 15;

  const handleShiftClick = (direction: -1 | 1) => {
    // Check bounds
    if ((direction === -1 && value <= -5) || (direction === 1 && value >= 5)) {
      return;
    }
    // Check actions
    if (currentActions < ACTION_COST) {
      alert(`Not enough actions. You need ${ACTION_COST} actions.`);
      return;
    }
    setShowConfirm({ direction });
  };

  const confirmShift = async () => {
    if (!showConfirm) return;
    setLoading(true);
    try {
      await onShift(axis, showConfirm.direction);
    } finally {
      setLoading(false);
      setShowConfirm(null);
    }
  };

  const getPositionLabel = (val: number) => {
    if (val === 0) return "Center";
    if (Math.abs(val) >= 4) return "Far " + (val < 0 ? leftLabel : rightLabel);
    return val < 0 ? leftLabel : rightLabel;
  };

  const getColorClass = (val: number) => {
    if (val < 0) return "text-blue-400";
    if (val > 0) return "text-red-400";
    return "text-purple-400";
  };

  const getBgClass = (val: number) => {
    if (val < 0) return "bg-blue-500";
    if (val > 0) return "bg-red-500";
    return "bg-purple-500";
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold capitalize">{axis} Position</h3>
          <p className="text-sm text-muted">Shift your stance on {axis} issues.</p>
        </div>
        <div className="text-xs font-medium px-2 py-1 rounded-full bg-secondary/10 text-secondary">
          Cost: {ACTION_COST} Actions
        </div>
      </div>

      <div className="mb-6 flex items-center justify-between gap-4">
        {/* Left Shift Button */}
        <button
          onClick={() => handleShiftClick(-1)}
          disabled={loading || value <= -5 || currentActions < ACTION_COST}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-card-border bg-background transition-colors hover:bg-card hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
          title={`Shift ${leftLabel}`}
        >
          ←
        </button>

        {/* Visual Indicator */}
        <div className="flex-1 text-center">
          <div className={`text-lg font-bold ${getColorClass(value)}`}>
            {getPositionLabel(value)} ({value > 0 ? "+" + value : value})
          </div>

          {/* Progress Bar Representation */}
          <div className="mt-2 h-2 w-full rounded-full bg-card-border relative overflow-hidden">
            {/* Center Marker */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-foreground/20 -translate-x-1/2 z-10"></div>

            {/* Value Indicator */}
            <div
              className={`absolute top-0 bottom-0 transition-all duration-300 ${getBgClass(value)}`}
              style={{
                left: "50%",
                width: `${(Math.abs(value) / 5) * 50}%`,
                transform: value < 0 ? "translateX(-100%)" : "none",
              }}
            ></div>
          </div>

          <div className="mt-1 flex justify-between text-[10px] text-muted uppercase tracking-wider">
            <span>{leftLabel}</span>
            <span>{rightLabel}</span>
          </div>
        </div>

        {/* Right Shift Button */}
        <button
          onClick={() => handleShiftClick(1)}
          disabled={loading || value >= 5 || currentActions < ACTION_COST}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-card-border bg-background transition-colors hover:bg-card hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
          title={`Shift ${rightLabel}`}
        >
          →
        </button>
      </div>

      <Modal
        open={Boolean(showConfirm)}
        title="Confirm Policy Shift"
        onClose={() => setShowConfirm(null)}
      >
        <p className="mb-4 text-sm text-muted">
          Are you sure you want to shift your {axis} position{" "}
          {showConfirm?.direction === -1 ? "left" : "right"}?
        </p>

        <div className="mb-6 space-y-2 rounded-lg bg-background p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Action Cost:</span>
            <span className="font-medium text-red-400">-{ACTION_COST} Actions</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Infamy:</span>
            <span className="font-medium text-red-400">+5 Points</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Political Influence:</span>
            <span className="font-medium text-red-400">-5% Reduction</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">National Influence:</span>
            <span className="font-medium text-red-400">-5% Reduction</span>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowConfirm(null)}
            className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary/10"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={confirmShift}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
            disabled={loading}
          >
            {loading ? "Shifting..." : "Confirm Shift"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
