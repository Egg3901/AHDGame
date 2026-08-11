"use client";

import { useState } from "react";
import type { InfluenceType } from "@/lib/db/types";

export interface InfluenceResult {
  success: boolean;
  message: string;
  outcome: string;
}

export function useInfluencePanelState() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAction, setSelectedAction] = useState<InfluenceType | null>(null);
  const [selectedElection, setSelectedElection] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [selectedTargetState, setSelectedTargetState] = useState("");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<InfluenceResult | null>(null);

  const resetForm = () => {
    setSelectedAction(null);
    setSelectedElection("");
    setSelectedCandidate("");
    setSelectedTargetState("");
    setResult(null);
    setError("");
  };

  return {
    loading,
    setLoading,
    error,
    setError,
    selectedAction,
    setSelectedAction,
    selectedElection,
    setSelectedElection,
    selectedCandidate,
    setSelectedCandidate,
    selectedTargetState,
    setSelectedTargetState,
    executing,
    setExecuting,
    result,
    setResult,
    resetForm,
  };
}
