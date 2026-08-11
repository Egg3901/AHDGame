"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { ElectionDetail, CandidateDetail } from "./ElectionDetailTypes";

const PresAdminPanel = dynamic(
  () => import("./PresAdminPanel").then((m) => ({ default: m.PresAdminPanel })),
  { ssr: false }
);
const ElectionAdminPanel = dynamic(
  () => import("./ElectionAdminPanel").then((m) => ({ default: m.ElectionAdminPanel })),
  { ssr: false }
);

interface AdminSectionProps {
  electionId: string;
  electionType: ElectionDetail["electionType"];
  isAdmin: boolean | undefined;
  adminOpen: boolean;
  localInPrimary: boolean;
  localIsEnded: boolean;
  candidates: CandidateDetail[];
  onToggleAdmin: () => void;
  onSuccess: () => void;
}

export function AdminSection({
  electionId,
  electionType,
  isAdmin,
  adminOpen,
  localInPrimary,
  localIsEnded,
  candidates,
  onToggleAdmin,
  onSuccess,
}: AdminSectionProps) {
  if (!isAdmin) return null;

  return (
    <div className="mb-6">
      <button
        onClick={onToggleAdmin}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-amber-400 transition-colors"
        title={adminOpen ? "Hide admin controls" : "Show admin controls"}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        Admin
        <svg
          className={`h-3 w-3 transition-transform ${adminOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {adminOpen && (
        <div className="mt-3">
          {electionType === "president" ? (
            <PresAdminPanel
              electionId={electionId}
              inPrimary={localInPrimary}
              isEnded={localIsEnded}
              candidates={candidates}
              onSuccess={onSuccess}
            />
          ) : (
            <ElectionAdminPanel
              electionId={electionId}
              inPrimary={localInPrimary}
              isEnded={localIsEnded}
              onSuccess={onSuccess}
            />
          )}
        </div>
      )}
    </div>
  );
}
