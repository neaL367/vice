import type {
  ViceFile,
  VicePreset,
  ViceResult,
  ViceScale,
} from "../types/vice";

export interface ViceJobState {
  files: ViceFile[];
  results: ViceResult[];
  selectedId: number | null;
  zipUrl: string | null;
  scale: ViceScale;
  chained4x: boolean;
  preset: VicePreset;
  dering: number;
  sharpness: number;
  progress: string;
  running: boolean;
  error: string;
}

export const initialState: ViceJobState = {
  files: [],
  results: [],
  selectedId: null,
  zipUrl: null,
  scale: 2,
  chained4x: false,
  preset: "photo",
  dering: 1.0,
  sharpness: 0.35,
  progress: "",
  running: false,
  error: "",
};

export type ViceJobAction =
  | { type: "PICK_FILES"; files: ViceFile[]; error?: string }
  | { type: "REMOVE_FILE"; previewUrl: string }
  | { type: "SET_SCALE"; scale: ViceScale }
  | { type: "SET_CHAINED_4X"; chained4x: boolean }
  | { type: "SET_PRESET"; preset: VicePreset }
  | { type: "SET_DERING"; dering: number }
  | { type: "SET_SHARPNESS"; sharpness: number }
  | { type: "SET_SELECTED_ID"; id: number | null }
  | { type: "START_RUN" }
  | { type: "SET_PROGRESS"; progress: string }
  | { type: "ADD_RESULT"; result: ViceResult }
  | { type: "FINISH_RUN" }
  | { type: "FAIL_RUN"; error?: string; progress?: string }
  | { type: "SET_ZIP_URL"; url: string }
  | { type: "SET_ERROR"; error: string };

export function viceJobReducer(
  state: ViceJobState,
  action: ViceJobAction
): ViceJobState {
  switch (action.type) {
    case "PICK_FILES":
      return {
        ...state,
        files: action.files,
        results: [],
        selectedId: null,
        zipUrl: null,
        error: action.error ?? "",
      };

    case "REMOVE_FILE": {
      const nextFiles = state.files.filter(
        (f) => f.previewUrl !== action.previewUrl
      );
      const nextResults = state.results.filter(
        (r) => r.previewUrl !== action.previewUrl
      );
      return {
        ...state,
        files: nextFiles,
        results: nextResults,
        selectedId: null,
        zipUrl: null,
      };
    }

    case "SET_SCALE":
      return { ...state, scale: action.scale };

    case "SET_CHAINED_4X":
      return { ...state, chained4x: action.chained4x };

    case "SET_PRESET":
      return { ...state, preset: action.preset };

    case "SET_DERING":
      return { ...state, dering: action.dering };

    case "SET_SHARPNESS":
      return { ...state, sharpness: action.sharpness };

    case "SET_SELECTED_ID":
      return { ...state, selectedId: action.id };

    case "START_RUN":
      return {
        ...state,
        running: true,
        error: "",
      };

    case "SET_PROGRESS":
      return { ...state, progress: action.progress };

    case "ADD_RESULT":
      return {
        ...state,
        results: [...state.results, action.result],
        selectedId:
          state.selectedId === null ? action.result.id : state.selectedId,
      };

    case "FINISH_RUN":
      return {
        ...state,
        running: false,
        progress: "done",
      };

    case "FAIL_RUN":
      return {
        ...state,
        running: false,
        error: action.error ?? state.error,
        progress: action.progress ?? state.progress,
      };

    case "SET_ZIP_URL":
      return { ...state, zipUrl: action.url };

    case "SET_ERROR":
      return { ...state, error: action.error };

    default:
      return state;
  }
}
