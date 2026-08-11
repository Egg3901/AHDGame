"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";

interface WikiReviewActionsProps {
  slug: string;
  onApprove: () => void;
  onReject: () => void;
}

export function WikiReviewActions({ slug, onApprove, onReject }: WikiReviewActionsProps) {
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);

  const handleApprove = async () => {
    if (!confirm("Approve this wiki page submission?")) return;

    setApproving(true);
    try {
      const response = await fetch(`/api/admin/wiki/review/${slug}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        onApprove();
      } else {
        const data = await response.json();
        alert(data.error || "Failed to approve");
      }
    } catch {
      alert("Failed to approve");
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (rejectReason.trim().length < 10) {
      alert("Reason must be at least 10 characters.");
      return;
    }

    setRejecting(true);
    try {
      const response = await fetch(`/api/admin/wiki/review/${slug}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });

      if (response.ok) {
        setShowRejectModal(false);
        setRejectReason("");
        onReject();
      } else {
        const data = await response.json();
        alert(data.error || "Failed to reject");
      }
    } catch {
      alert("Failed to reject");
    } finally {
      setRejecting(false);
    }
  };

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={approving}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
        >
          {approving ? "Approving..." : "Approve"}
        </button>
        <button
          onClick={() => setShowRejectModal(true)}
          disabled={rejecting}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
        >
          Reject
        </button>
      </div>

      <Modal
        open={showRejectModal}
        title="Reject Submission"
        onClose={() => {
          setShowRejectModal(false);
          setRejectReason("");
        }}
      >
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Provide a reason for rejection..."
          rows={4}
          className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => {
              setShowRejectModal(false);
              setRejectReason("");
            }}
            className="px-4 py-2 border border-card-border rounded-md text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleReject}
            disabled={rejecting || !rejectReason.trim()}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {rejecting ? "Rejecting..." : "Confirm Reject"}
          </button>
        </div>
      </Modal>
    </>
  );
}
