import { useReducer } from "react";
import type { CaucusListEntry, ChairMemberOption, RecruitableNppOption } from "./caucusTypes";

type State = {
  taxRate: number;
  name: string;
  description: string;
  color: string;
  motto: string;
  discordInviteUrl: string;
  savingMeta: boolean;
  newTopic: string;
  newStance: string;
  newNote: string;
  newWeight: "core" | "secondary";
  addingPosition: boolean;
  memberOptions: ChairMemberOption[];
  loadingMembers: boolean;
  selectedMemberId: string;
  recruitableNpps: RecruitableNppOption[];
  loadingRecruitableNpps: boolean;
  selectedRecruitNppId: string;
  caucusRecruitCooldownUntil: string | null;
  recruitingNpp: boolean;
  memberSendAmount: string;
  nationalTransferAmount: string;
  sendingFunds: boolean;
  transferringFunds: boolean;
};

type Action =
  | { type: "RESET_META"; caucus: CaucusListEntry }
  | { type: "SET_TAX_RATE"; value: number }
  | { type: "SET_NAME"; value: string }
  | { type: "SET_DESCRIPTION"; value: string }
  | { type: "SET_COLOR"; value: string }
  | { type: "SET_MOTTO"; value: string }
  | { type: "SET_DISCORD_INVITE_URL"; value: string }
  | { type: "SET_SAVING_META"; value: boolean }
  | { type: "SET_NEW_TOPIC"; value: string }
  | { type: "SET_NEW_STANCE"; value: string }
  | { type: "SET_NEW_NOTE"; value: string }
  | { type: "SET_NEW_WEIGHT"; value: "core" | "secondary" }
  | { type: "SET_ADDING_POSITION"; value: boolean }
  | { type: "CLEAR_NEW_POSITION" }
  | { type: "SET_MEMBERS"; options: ChairMemberOption[] }
  | { type: "SET_LOADING_MEMBERS"; value: boolean }
  | { type: "SET_SELECTED_MEMBER"; id: string }
  | {
      type: "SET_RECRUITABLES";
      options: RecruitableNppOption[];
      cooldownUntil: string | null;
    }
  | { type: "SET_LOADING_RECRUITABLES"; value: boolean }
  | { type: "SET_SELECTED_RECRUIT_NPP"; id: string }
  | { type: "SET_RECRUITING_NPP"; value: boolean }
  | { type: "SET_MEMBER_SEND_AMOUNT"; value: string }
  | { type: "SET_NATIONAL_TRANSFER_AMOUNT"; value: string }
  | { type: "SET_SENDING_FUNDS"; value: boolean }
  | { type: "SET_TRANSFERRING_FUNDS"; value: boolean }
  | { type: "CLEAR_MEMBER_SEND" }
  | { type: "CLEAR_NATIONAL_TRANSFER" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "RESET_META":
      return {
        ...state,
        taxRate: action.caucus.taxRate,
        name: action.caucus.name,
        description: action.caucus.description,
        color: action.caucus.color,
        motto: action.caucus.motto ?? "",
        discordInviteUrl: action.caucus.discordInviteUrl ?? "",
      };
    case "SET_TAX_RATE":
      return { ...state, taxRate: action.value };
    case "SET_NAME":
      return { ...state, name: action.value };
    case "SET_DESCRIPTION":
      return { ...state, description: action.value };
    case "SET_COLOR":
      return { ...state, color: action.value };
    case "SET_MOTTO":
      return { ...state, motto: action.value };
    case "SET_DISCORD_INVITE_URL":
      return { ...state, discordInviteUrl: action.value };
    case "SET_SAVING_META":
      return { ...state, savingMeta: action.value };
    case "SET_NEW_TOPIC":
      return { ...state, newTopic: action.value };
    case "SET_NEW_STANCE":
      return { ...state, newStance: action.value };
    case "SET_NEW_NOTE":
      return { ...state, newNote: action.value };
    case "SET_NEW_WEIGHT":
      return { ...state, newWeight: action.value };
    case "SET_ADDING_POSITION":
      return { ...state, addingPosition: action.value };
    case "CLEAR_NEW_POSITION":
      return { ...state, newTopic: "", newStance: "", newNote: "" };
    case "SET_MEMBERS": {
      const options = action.options;
      const currentId = state.selectedMemberId;
      const selectedMemberId =
        currentId && options.some((o) => o.id === currentId) ? currentId : (options[0]?.id ?? "");
      return { ...state, memberOptions: options, loadingMembers: false, selectedMemberId };
    }
    case "SET_LOADING_MEMBERS":
      return { ...state, loadingMembers: action.value };
    case "SET_SELECTED_MEMBER":
      return { ...state, selectedMemberId: action.id };
    case "SET_RECRUITABLES": {
      const options = action.options;
      const currentId = state.selectedRecruitNppId;
      const selectedRecruitNppId =
        currentId && options.some((o) => o.id === currentId)
          ? currentId
          : (options.find((o) => o.eligible)?.id ?? options[0]?.id ?? "");
      return {
        ...state,
        recruitableNpps: options,
        loadingRecruitableNpps: false,
        selectedRecruitNppId,
        caucusRecruitCooldownUntil: action.cooldownUntil,
      };
    }
    case "SET_LOADING_RECRUITABLES":
      return { ...state, loadingRecruitableNpps: action.value };
    case "SET_SELECTED_RECRUIT_NPP":
      return { ...state, selectedRecruitNppId: action.id };
    case "SET_RECRUITING_NPP":
      return { ...state, recruitingNpp: action.value };
    case "SET_MEMBER_SEND_AMOUNT":
      return { ...state, memberSendAmount: action.value };
    case "SET_NATIONAL_TRANSFER_AMOUNT":
      return { ...state, nationalTransferAmount: action.value };
    case "SET_SENDING_FUNDS":
      return { ...state, sendingFunds: action.value };
    case "SET_TRANSFERRING_FUNDS":
      return { ...state, transferringFunds: action.value };
    case "CLEAR_MEMBER_SEND":
      return { ...state, memberSendAmount: "" };
    case "CLEAR_NATIONAL_TRANSFER":
      return { ...state, nationalTransferAmount: "" };
  }
}

export function useChairSubtabState(caucus: CaucusListEntry) {
  const [state, dispatch] = useReducer(reducer, {
    taxRate: caucus.taxRate,
    name: caucus.name,
    description: caucus.description,
    color: caucus.color,
    motto: caucus.motto ?? "",
    discordInviteUrl: caucus.discordInviteUrl ?? "",
    savingMeta: false,
    newTopic: "",
    newStance: "",
    newNote: "",
    newWeight: "secondary",
    addingPosition: false,
    memberOptions: [],
    loadingMembers: true,
    selectedMemberId: "",
    recruitableNpps: [],
    loadingRecruitableNpps: true,
    selectedRecruitNppId: "",
    caucusRecruitCooldownUntil: null,
    recruitingNpp: false,
    memberSendAmount: "",
    nationalTransferAmount: "",
    sendingFunds: false,
    transferringFunds: false,
  });
  return { state, dispatch };
}
