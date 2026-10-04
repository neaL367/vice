"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  JobController,
  canPickDirectory,
  canSaveToDisk,
  type JobCallbacks,
  type JobTuningOptions,
} from "../state/job-controller";
import type { ViceFile, ViceScale } from "../types/vice";

export function useUpscaleController() {
  const controllerRef = useRef<JobController | null>(null);

  if (controllerRef.current == null) {
    controllerRef.current = new JobController();
  }

  useEffect(() => {
    const ctrl = controllerRef.current;
    return () => {
      ctrl?.terminate();
    };
  }, []);

  const warm = useCallback(() => {
    controllerRef.current?.warm();
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.cancel();
  }, []);

  const runBatch = useCallback(
    (
      files: ViceFile[],
      scale: ViceScale,
      tuning: JobTuningOptions,
      cb: JobCallbacks,
    ) => {
      return controllerRef.current?.runBatch(files, scale, tuning, cb);
    },
    [],
  );

  const runToFile = useCallback(
    (
      file: ViceFile,
      scale: ViceScale,
      tuning: JobTuningOptions,
      cb: JobCallbacks,
    ) => {
      return controllerRef.current?.runToFile(file, scale, tuning, cb);
    },
    [],
  );

  const runBatchToFolder = useCallback(
    (
      files: ViceFile[],
      scale: ViceScale,
      tuning: JobTuningOptions,
      cb: JobCallbacks,
    ) => {
      return controllerRef.current?.runBatchToFolder(files, scale, tuning, cb);
    },
    [],
  );

  return {
    warm,
    cancel,
    runBatch,
    runToFile,
    runBatchToFolder,
    canSaveToDisk: canSaveToDisk(),
    canPickDirectory: canPickDirectory(),
  };
}
