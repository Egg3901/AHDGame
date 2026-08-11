"use client";

import { useReducer, useCallback } from "react";
import {
  mapSnapElectionViewerState,
  type ExecutiveGovernmentResponse,
} from "@/lib/government/executiveViewerState";

interface State {
  viewerMayAppoint: boolean;
  viewerMayProposeNoConfidence: boolean;
  viewerIsMp: boolean;
  viewerIsSittingPM: boolean;
  snapElectionsAllowed: boolean;
  snapElectionsUsed: number;
  snapElectionsRemaining: number;
  snapCooldownTurnsRemaining: number;
  appointModalOpen: boolean;
  noConfirmOpen: boolean;
  proposingNoConfidence: boolean;
  viewerIsAdmin: boolean;
  myHasActiveBill: boolean;
  showProposeModal: boolean;
  showCabinetProposeModal: boolean;
  canProposeCabinetBill: boolean;
}

type Action =
  | {
      type: "SYNC_GOVERNMENT_DATA";
      payload: {
        viewerMayAppoint: boolean;
        viewerMayProposeNoConfidence: boolean;
        viewerIsMp: boolean;
        viewerIsSittingPM: boolean;
        snapElectionsAllowed: boolean;
        snapElectionsUsed: number;
        snapElectionsRemaining: number;
        snapCooldownTurnsRemaining: number;
      };
    }
  | { type: "SET_VIEWER_IS_ADMIN"; value: boolean }
  | { type: "SET_MY_HAS_ACTIVE_BILL"; value: boolean }
  | { type: "SET_APPOINT_MODAL_OPEN"; value: boolean }
  | { type: "SET_NO_CONFIRM_OPEN"; value: boolean }
  | { type: "SET_PROPOSING_NO_CONFIDENCE"; value: boolean }
  | { type: "SET_SHOW_PROPOSE_MODAL"; value: boolean }
  | { type: "SET_SHOW_CABINET_PROPOSE_MODAL"; value: boolean }
  | { type: "SET_CAN_PROPOSE_CABINET_BILL"; value: boolean };

const initial: State = {
  viewerMayAppoint: false,
  viewerMayProposeNoConfidence: false,
  viewerIsMp: false,
  viewerIsSittingPM: false,
  snapElectionsAllowed: false,
  snapElectionsUsed: 0,
  snapElectionsRemaining: 0,
  snapCooldownTurnsRemaining: 0,
  appointModalOpen: false,
  noConfirmOpen: false,
  proposingNoConfidence: false,
  viewerIsAdmin: false,
  myHasActiveBill: false,
  showProposeModal: false,
  showCabinetProposeModal: false,
  canProposeCabinetBill: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SYNC_GOVERNMENT_DATA":
      return { ...state, ...action.payload };
    case "SET_VIEWER_IS_ADMIN":
      return { ...state, viewerIsAdmin: action.value };
    case "SET_MY_HAS_ACTIVE_BILL":
      return { ...state, myHasActiveBill: action.value };
    case "SET_APPOINT_MODAL_OPEN":
      return { ...state, appointModalOpen: action.value };
    case "SET_NO_CONFIRM_OPEN":
      return { ...state, noConfirmOpen: action.value };
    case "SET_PROPOSING_NO_CONFIDENCE":
      return { ...state, proposingNoConfidence: action.value };
    case "SET_SHOW_PROPOSE_MODAL":
      return { ...state, showProposeModal: action.value };
    case "SET_SHOW_CABINET_PROPOSE_MODAL":
      return { ...state, showCabinetProposeModal: action.value };
    case "SET_CAN_PROPOSE_CABINET_BILL":
      return { ...state, canProposeCabinetBill: action.value };
    default:
      return state;
  }
}

export function useJPDietPageState() {
  const [state, dispatch] = useReducer(reducer, initial);

  const syncGovernmentData = useCallback(
    (data: ExecutiveGovernmentResponse) => {
      dispatch({
        type: "SYNC_GOVERNMENT_DATA",
        payload: {
          viewerMayAppoint: data.viewerMayAppoint ?? false,
          viewerMayProposeNoConfidence: data.viewerMayProposeNoConfidence ?? false,
          viewerIsMp: data.viewerIsCommonsMp ?? false,
          ...mapSnapElectionViewerState(data),
        },
      });
    },
    [dispatch]
  );

  return {
    ...state,
    syncGovernmentData,
    setViewerIsAdmin: (v: boolean) => dispatch({ type: "SET_VIEWER_IS_ADMIN", value: v }),
    setMyHasActiveBill: (v: boolean) => dispatch({ type: "SET_MY_HAS_ACTIVE_BILL", value: v }),
    setAppointModalOpen: (v: boolean) => dispatch({ type: "SET_APPOINT_MODAL_OPEN", value: v }),
    setNoConfirmOpen: (v: boolean) => dispatch({ type: "SET_NO_CONFIRM_OPEN", value: v }),
    setProposingNoConfidence: (v: boolean) =>
      dispatch({ type: "SET_PROPOSING_NO_CONFIDENCE", value: v }),
    setShowProposeModal: (v: boolean) => dispatch({ type: "SET_SHOW_PROPOSE_MODAL", value: v }),
    setShowCabinetProposeModal: (v: boolean) =>
      dispatch({ type: "SET_SHOW_CABINET_PROPOSE_MODAL", value: v }),
    setCanProposeCabinetBill: (v: boolean) =>
      dispatch({ type: "SET_CAN_PROPOSE_CABINET_BILL", value: v }),
  };
}
