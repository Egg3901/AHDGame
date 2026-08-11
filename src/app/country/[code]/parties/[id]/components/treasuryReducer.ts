// ─── Reducer ──────────────────────────────────────────────────────────────────

export interface TreasuryState {
  taxForm: { rate: number; saving: boolean };
  gotvForm: { percent: number; category: string; group: string; saving: boolean };
  suppressionForm: { percent: number; category: string; group: string; saving: boolean };
  registrationForm: { percent: number; saving: boolean };
  reserveForm: {
    transferReserveAmount: string;
    memberSupportReserveAmount: string;
    nppRecruitmentReserveAmount: string;
    saving: boolean;
  };
  transferForm: { state: string; amount: string; transferring: boolean };
  sendForm: { memberId: string; amount: string; sending: boolean };
  donateForm: { amount: string; donating: boolean };
  msg: string;
}

export type TreasuryAction =
  | { type: "SET_TAX_RATE"; payload: number }
  | { type: "SET_TAX_SAVING"; payload: boolean }
  | { type: "SET_GOTV"; field: "percent" | "category" | "group"; value: string | number }
  | { type: "SET_GOTV_SAVING"; payload: boolean }
  | { type: "SET_SUPPRESSION"; field: "percent" | "category" | "group"; value: string | number }
  | { type: "SET_SUPPRESSION_SAVING"; payload: boolean }
  | { type: "SET_REGISTRATION"; field: "percent"; value: number }
  | { type: "SET_REGISTRATION_SAVING"; payload: boolean }
  | {
      type: "SET_RESERVE";
      field: "transferReserveAmount" | "memberSupportReserveAmount" | "nppRecruitmentReserveAmount";
      value: string;
    }
  | {
      type: "SYNC_RESERVE_FORM";
      payload: {
        transferReserveAmount: string;
        memberSupportReserveAmount: string;
        nppRecruitmentReserveAmount: string;
      };
    }
  | { type: "SET_RESERVE_SAVING"; payload: boolean }
  | { type: "SET_TRANSFER"; field: "state" | "amount"; value: string }
  | { type: "SET_TRANSFERRING"; payload: boolean }
  | { type: "RESET_TRANSFER" }
  | { type: "SET_SEND"; field: "memberId" | "amount"; value: string }
  | { type: "SET_SENDING"; payload: boolean }
  | { type: "RESET_SEND" }
  | { type: "SET_DONATE_AMOUNT"; payload: string }
  | { type: "SET_DONATING"; payload: boolean }
  | { type: "RESET_DONATE" }
  | { type: "SET_MSG"; payload: string };

export function treasuryReducer(state: TreasuryState, action: TreasuryAction): TreasuryState {
  switch (action.type) {
    case "SET_TAX_RATE":
      return { ...state, taxForm: { ...state.taxForm, rate: action.payload } };
    case "SET_TAX_SAVING":
      return { ...state, taxForm: { ...state.taxForm, saving: action.payload } };
    case "SET_GOTV":
      return { ...state, gotvForm: { ...state.gotvForm, [action.field]: action.value } };
    case "SET_GOTV_SAVING":
      return { ...state, gotvForm: { ...state.gotvForm, saving: action.payload } };
    case "SET_SUPPRESSION":
      return {
        ...state,
        suppressionForm: { ...state.suppressionForm, [action.field]: action.value },
      };
    case "SET_SUPPRESSION_SAVING":
      return { ...state, suppressionForm: { ...state.suppressionForm, saving: action.payload } };
    case "SET_REGISTRATION":
      return {
        ...state,
        registrationForm: { ...state.registrationForm, [action.field]: action.value },
      };
    case "SET_REGISTRATION_SAVING":
      return { ...state, registrationForm: { ...state.registrationForm, saving: action.payload } };
    case "SET_RESERVE":
      return { ...state, reserveForm: { ...state.reserveForm, [action.field]: action.value } };
    case "SYNC_RESERVE_FORM":
      return {
        ...state,
        reserveForm: { ...state.reserveForm, ...action.payload },
      };
    case "SET_RESERVE_SAVING":
      return { ...state, reserveForm: { ...state.reserveForm, saving: action.payload } };
    case "SET_TRANSFER":
      return { ...state, transferForm: { ...state.transferForm, [action.field]: action.value } };
    case "SET_TRANSFERRING":
      return { ...state, transferForm: { ...state.transferForm, transferring: action.payload } };
    case "RESET_TRANSFER":
      return { ...state, transferForm: { state: "", amount: "", transferring: false } };
    case "SET_SEND":
      return { ...state, sendForm: { ...state.sendForm, [action.field]: action.value } };
    case "SET_SENDING":
      return { ...state, sendForm: { ...state.sendForm, sending: action.payload } };
    case "RESET_SEND":
      return { ...state, sendForm: { memberId: "", amount: "", sending: false } };
    case "SET_DONATE_AMOUNT":
      return { ...state, donateForm: { ...state.donateForm, amount: action.payload } };
    case "SET_DONATING":
      return { ...state, donateForm: { ...state.donateForm, donating: action.payload } };
    case "RESET_DONATE":
      return { ...state, donateForm: { amount: "", donating: false } };
    case "SET_MSG":
      return { ...state, msg: action.payload };
    default:
      return state;
  }
}
