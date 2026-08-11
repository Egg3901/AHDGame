"use client";

import { useReducer } from "react";
import type {
  AppointmentVotePayload,
  NoConfidenceVotePayload,
} from "@/types/parliamentaryGovernment";
import {
  mapSnapElectionViewerState,
  type ExecutiveGovernmentResponse,
} from "@/lib/government/executiveViewerState";

export type GovernmentData = {
  status: "pending" | "formed";
  formationType: "majority" | "coalition" | "minority" | "admin" | null;
  lostMajority: boolean;
  pmName: string | null;
  pmCharacterId: string | null;
  governingPartyId: string | null;
  coalitionPartyIds: string[] | null;
} | null;

interface State {
  government: GovernmentData;
  activeAppointmentVotes: AppointmentVotePayload[];
  activeNoConfidenceVote: NoConfidenceVotePayload | null;
  viewerMayAppoint: boolean;
  viewerMayProposeNoConfidence: boolean;
  noConfidenceCooldownTurns: number | null;
  viewerIsCommonsMp: boolean;
  viewerVotes: Record<string, "aye" | "nay">;
  viewerWhippedFrom: Record<string, string>;
  viewerIsSittingPM: boolean;
  snapElectionsAllowed: boolean;
  snapElectionsUsed: number;
  snapElectionsRemaining: number;
  snapCooldownTurnsRemaining: number;
}

type Action = { type: "SYNC_GOVERNMENT_DATA"; payload: State };

const initial: State = {
  government: null,
  activeAppointmentVotes: [],
  activeNoConfidenceVote: null,
  viewerMayAppoint: false,
  viewerMayProposeNoConfidence: false,
  noConfidenceCooldownTurns: null,
  viewerIsCommonsMp: false,
  viewerVotes: {},
  viewerWhippedFrom: {},
  viewerIsSittingPM: false,
  snapElectionsAllowed: false,
  snapElectionsUsed: 0,
  snapElectionsRemaining: 0,
  snapCooldownTurnsRemaining: 0,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SYNC_GOVERNMENT_DATA":
      return action.payload;
    default:
      return state;
  }
}

export function useUKParliamentPageState() {
  const [state, dispatch] = useReducer(reducer, initial);

  function syncGovernmentData(data: ExecutiveGovernmentResponse) {
    dispatch({
      type: "SYNC_GOVERNMENT_DATA",
      payload: {
        government: data.government ?? null,
        activeAppointmentVotes: data.activeAppointmentVotes ?? [],
        activeNoConfidenceVote: data.activeNoConfidenceVote ?? null,
        viewerMayAppoint: data.viewerMayAppoint ?? false,
        viewerMayProposeNoConfidence: data.viewerMayProposeNoConfidence ?? false,
        noConfidenceCooldownTurns: data.noConfidenceCooldownTurns ?? null,
        viewerIsCommonsMp: data.viewerIsCommonsMp ?? false,
        viewerVotes: data.viewerVotes ?? {},
        viewerWhippedFrom: data.viewerWhippedFrom ?? {},
        ...mapSnapElectionViewerState(data),
      },
    });
  }

  return { ...state, syncGovernmentData };
}
