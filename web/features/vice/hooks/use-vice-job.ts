"use client";

import { startTransition, useCallback, useMemo } from "react";
import type { ViceResult } from "../types/vice";
import { useUpscaleWorkspace } from "./use-upscale-workspace";
import { useUpscaleController } from "./use-upscale-controller";

export function useViceJob() {
  const workspace = useUpscaleWorkspace();
  const controller = useUpscaleController();
  const { state, dispatch, track } = workspace;

  const createJobCallbacks = useCallback(
    (onResultExtra?: (result: ViceResult) => void) => ({
      // Transitions abort with "invalid state" while the document is hidden
      // (worker progress keeps firing with the tab in background), which
      // Next logs as an uncaught recoverable error. Updates are invisible
      // while hidden anyway: progress is dropped, the rest dispatch
      // directly instead of in a transition.
      onProgress: (progress: string) => {
        if (typeof document !== "undefined" && document.hidden) return;
        startTransition(() => dispatch({ type: "SET_PROGRESS", progress }));
      },
      onResult: (result: ViceResult) => {
        if (typeof document !== "undefined" && document.hidden) {
          dispatch({ type: "ADD_RESULT", result });
          onResultExtra?.(result);
          return;
        }
        startTransition(() => {
          dispatch({ type: "ADD_RESULT", result });
          onResultExtra?.(result);
        });
      },
      onFinish: () => {
        if (typeof document !== "undefined" && document.hidden) {
          dispatch({ type: "FINISH_RUN" });
          return;
        }
        startTransition(() => dispatch({ type: "FINISH_RUN" }));
      },
      onError: (error: string, cancelled?: boolean) => {
        if (typeof document !== "undefined" && document.hidden) {
          dispatch({ type: "FAIL_RUN", progress: cancelled ? "cancelled" : undefined, error: cancelled ? undefined : error });
          return;
        }
        startTransition(() => {
          if (cancelled) {
            dispatch({ type: "FAIL_RUN", progress: "cancelled" });
          } else {
            dispatch({ type: "FAIL_RUN", error });
          }
        });
      },
      trackUrl: track,
    }),
    [dispatch, track],
  );

  const currentTuning = useMemo(
    () => ({
      chained4x: state.chained4x,
    }),
    [state.chained4x],
  );

  const run = useCallback(async () => {
    if (state.running || state.files.length === 0) return;
    dispatch({ type: "START_RUN" });
    await controller.runBatch(state.files, state.scale, currentTuning, createJobCallbacks());
  }, [state, dispatch, controller, currentTuning, createJobCallbacks]);

  const runToFile = useCallback(async () => {
    if (state.running || state.files.length !== 1) return;
    dispatch({ type: "START_RUN" });
    await controller.runToFile(
      state.files[0],
      state.scale,
      currentTuning,
      createJobCallbacks(() => dispatch({ type: "FINISH_RUN" })),
    );
  }, [state, dispatch, controller, currentTuning, createJobCallbacks]);

  const runBatchToFolder = useCallback(async () => {
    if (state.running || state.files.length < 2) return;
    dispatch({ type: "START_RUN" });
    await controller.runBatchToFolder(
      state.files,
      state.scale,
      currentTuning,
      createJobCallbacks(),
    );
  }, [state, dispatch, controller, currentTuning, createJobCallbacks]);

  const pickWithWarm = useCallback(
    (files: File[] | FileList | undefined | null) => {
      workspace.pick(files);
      controller.warm();
    },
    [workspace, controller],
  );

  return {
    files: state.files,
    results: state.results,
    selectedId: state.selectedId,
    setSelectedId: workspace.setSelectedId,
    zipUrl: state.zipUrl,
    scale: state.scale,
    setScale: workspace.setScale,
    chained4x: state.chained4x,
    setChained4x: workspace.setChained4x,
    progress: state.progress,
    running: state.running,
    error: state.error,
    pick: pickWithWarm,
    removeFile: workspace.removeFile,
    run,
    runToFile,
    runBatchToFolder,
    canSaveToDisk: controller.canSaveToDisk,
    canPickDirectory: controller.canPickDirectory,
    cancel: controller.cancel,
    downloadZip: workspace.downloadZip,
  };
}
