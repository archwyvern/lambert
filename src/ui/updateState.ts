import type { UpdateEvent } from "./host";

export type UpdatePhase =
  | "idle" | "checking" | "available" | "downloading" | "downloaded" | "uptodate" | "error";

export interface UpdateState {
  phase: UpdatePhase;
  version?: string;
  percent?: number;
  message?: string;
  /** Whether the in-flight check was user-initiated (gates the "up to date" / error surfacing). */
  manual: boolean;
}

export const initialUpdateState: UpdateState = { phase: "idle", manual: false };

export type UpdateAction = { type: "check"; manual: boolean } | { type: "download" } | { type: "dismiss" } | UpdateEvent;

export function reduceUpdate(state: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case "check": return { phase: "checking", manual: action.manual };
    case "checking": return { ...state, phase: "checking" };
    case "available": return { phase: "available", version: action.version, manual: state.manual };
    case "not-available": return state.manual ? { phase: "uptodate", manual: false } : { phase: "idle", manual: false };
    // Clicking Download enters "downloading" IMMEDIATELY (before the first progress event). This gives
    // instant feedback AND makes a download that fails before any progress surface its error (the error
    // case below keys off phase === "downloading") instead of silently vanishing.
    case "download": return { phase: "downloading", version: state.version, percent: 0, manual: state.manual };
    case "progress": return { ...state, phase: "downloading", percent: action.percent };
    case "downloaded": return { phase: "downloaded", version: action.version, manual: state.manual };
    case "error":
      if (state.manual || state.phase === "downloading") return { phase: "error", message: action.message, manual: false };
      return { phase: "idle", manual: false };
    case "dismiss": return { phase: "idle", manual: false };
  }
}
