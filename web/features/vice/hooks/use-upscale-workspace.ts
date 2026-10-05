"use client";

import { uniqueName } from "../planner/names";
import {
  startTransition,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import type {
  ViceFile,
  ViceResult,
  ViceScale,
} from "../types/vice";
import { initialJobState, viceJobReducer } from "../state/job-reducer";

const MAX_FILES = 10;
const IMAGE_RE = /^image\/(png|jpeg|webp)$/;

export function useUpscaleWorkspace() {
  const [state, dispatch] = useReducer(viceJobReducer, initialJobState);

  const urlsRef = useRef<string[]>([]);
  const zipUrlRef = useRef<string | null>(null);

  const track = useCallback((url: string) => {
    urlsRef.current.push(url);
    return url;
  }, []);

  const revokeAll = useCallback(() => {
    for (const u of urlsRef.current) URL.revokeObjectURL(u);
    urlsRef.current = [];
  }, []);

  useEffect(() => {
    const onPageHide = () => revokeAll();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [revokeAll]);

  const pick = useCallback(
    (incoming: File[] | FileList | undefined | null) => {
      if (!incoming) return;
      if (state.running) {
        dispatch({
          type: "SET_ERROR",
          error: "Finish or cancel the current batch before picking new files.",
        });
        return;
      }
      const list = [...incoming].slice(0, MAX_FILES);
      if (list.length === 0) return;

      let warning = "";
      if ([...incoming].length > MAX_FILES) {
        warning = `Only first ${MAX_FILES} files kept.`;
      }

      const bad = list.find((f) => !IMAGE_RE.test(f.type));
      if (bad) {
        dispatch({
          type: "SET_ERROR",
          error: `Unsupported type: ${bad.name}. PNG/JPEG/WebP only.`,
        });
        return;
      }

      revokeAll();
      zipUrlRef.current = null;
      const next: ViceFile[] = list.map((file) => ({
        file,
        previewUrl: track(URL.createObjectURL(file)),
      }));

      startTransition(() => {
        dispatch({ type: "PICK_FILES", files: next, error: warning });
      });
    },
    [state.running, revokeAll, track],
  );

  const removeFile = useCallback(
    (previewUrl: string) => {
      if (state.running) return;
      const target = urlsRef.current.indexOf(previewUrl);
      if (target >= 0) {
        URL.revokeObjectURL(previewUrl);
        urlsRef.current.splice(target, 1);
      }
      startTransition(() => {
        dispatch({ type: "REMOVE_FILE", previewUrl });
      });
    },
    [state.running],
  );

  const downloadZip = useCallback(async () => {
    const zippable = state.results.filter((r) => !r.savedToDisk);
    if (zippable.length < 2) return;
    const { BlobReader, BlobWriter, ZipWriter } = await import("@zip.js/zip.js");
    const writer = new ZipWriter(new BlobWriter("application/zip"), {
      useWebWorkers: false,
    });
    const used = new Set<string>();
    for (const r of zippable) {
      const stem = r.name.replace(/\.[^.]*$/, "") || "image";
      const entry = uniqueName(`${stem}-vice${r.scale}x`, "png", (n) => used.has(n));
      used.add(entry);
      await writer.add(entry, new BlobReader(r.blob));
    }
    const blob = await writer.close();
    if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current);
    const url = track(URL.createObjectURL(blob));
    zipUrlRef.current = url;
    dispatch({ type: "SET_ZIP_URL", url });
  }, [state.results, track]);

  const setScale = useCallback((scale: ViceScale) => {
    dispatch({ type: "SET_SCALE", scale });
  }, []);

  const setChained4x = useCallback((chained4x: boolean) => {
    dispatch({ type: "SET_CHAINED_4X", chained4x });
  }, []);

  const setSelectedId = useCallback((id: number | null) => {
    startTransition(() => {
      dispatch({ type: "SET_SELECTED_ID", id });
    });
  }, []);

  return {
    state,
    dispatch,
    track,
    pick,
    removeFile,
    downloadZip,
    setScale,
    setChained4x,
    setSelectedId,
  };
}
