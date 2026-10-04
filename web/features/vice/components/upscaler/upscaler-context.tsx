"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useViceJob } from "../../hooks/use-vice-job";
import type { ViceFile, ViceResult } from "../../types/vice";

export interface UpscalerContextValue {
  job: ReturnType<typeof useViceJob>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  fileInputId: string;
  isDragOver: boolean;
  setIsDragOver: (b: boolean) => void;
  fileDimensions: Record<string, { w: number; h: number }>;
  onImageLoad: (url: string, e: React.SyntheticEvent<HTMLImageElement>) => void;
  exportFormat: "png" | "webp" | "jpeg";
  setExportFormat: (fmt: "png" | "webp" | "jpeg") => void;
  customFormatUrl: { format: string; url: string; id: number } | null;
  isQueueOpen: boolean;
  setIsQueueOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isInspectorOpen: boolean;
  setIsInspectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedResult: ViceResult | undefined;
  hasResults: boolean;
  hasFiles: boolean;
  stagedFile: ViceFile | undefined;
  stagedDims: { w: number; h: number } | undefined;
}

const UpscalerContext = createContext<UpscalerContextValue | null>(null);

export function useUpscaler(): UpscalerContextValue {
  const ctx = useContext(UpscalerContext);
  if (!ctx) {
    throw new Error(
      "Upscaler compound components must be used within an <Upscaler.Root /> provider",
    );
  }
  return ctx;
}

export function UpscalerProvider({ children }: { children: ReactNode }) {
  const job = useViceJob();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [fileDimensions, setFileDimensions] = useState<
    Record<string, { w: number; h: number }>
  >({});
  const [exportFormat, setExportFormat] = useState<"png" | "webp" | "jpeg">("png");
  const [customFormatUrl, setCustomFormatUrl] = useState<{
    format: string;
    url: string;
    id: number;
  } | null>(null);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  const selectedResult: ViceResult | undefined =
    job.results.find((r) => r.id === job.selectedId) ?? job.results[0];
  const hasResults = job.results.length > 0;
  const hasFiles = job.files.length > 0;

  const stagedFile = job.files[0];
  const stagedDims = stagedFile
    ? fileDimensions[stagedFile.previewUrl]
    : undefined;

  const onImageLoad = useCallback(
    (url: string, e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      if (img.naturalWidth && img.naturalHeight) {
        setFileDimensions((prev) => ({
          ...prev,
          [url]: { w: img.naturalWidth, h: img.naturalHeight },
        }));
      }
    },
    [],
  );

  // Convert PNG blob to WebP / JPEG when user picks non-PNG format.
  // Skipped for save-to-disk results: blobUrl is a small preview, and the
  // full PNG already lives on disk.
  useEffect(() => {
    if (!selectedResult || exportFormat === "png" || selectedResult.savedToDisk) return;
    let active = true;
    const mime = exportFormat === "webp" ? "image/webp" : "image/jpeg";
    const img = new Image();
    img.src = selectedResult.blobUrl;
    img.onload = () => {
      if (!active) return;
      const canvas = document.createElement("canvas");
      canvas.width = selectedResult.outW;
      canvas.height = selectedResult.outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (exportFormat === "jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      const quality = exportFormat === "webp" ? 1.0 : 0.95;
      canvas.toBlob(
        (blob) => {
          if (!active || !blob) return;
          const url = URL.createObjectURL(blob);
          setCustomFormatUrl({ format: exportFormat, url, id: selectedResult.id });
        },
        mime,
        quality,
      );
    };
    return () => {
      active = false;
    };
  }, [selectedResult, exportFormat]);

  useEffect(() => {
    return () => {
      if (customFormatUrl?.url && customFormatUrl.url.startsWith("blob:")) {
        URL.revokeObjectURL(customFormatUrl.url);
      }
    };
  }, [customFormatUrl]);

  const value = useMemo<UpscalerContextValue>(
    () => ({
      job,
      fileInputRef,
      fileInputId,
      isDragOver,
      setIsDragOver,
      fileDimensions,
      onImageLoad,
      exportFormat,
      setExportFormat,
      customFormatUrl,
      isQueueOpen,
      setIsQueueOpen,
      isInspectorOpen,
      setIsInspectorOpen,
      selectedResult,
      hasResults,
      hasFiles,
      stagedFile,
      stagedDims,
    }),
    [
      job,
      fileInputId,
      isDragOver,
      fileDimensions,
      onImageLoad,
      exportFormat,
      customFormatUrl,
      isQueueOpen,
      isInspectorOpen,
      selectedResult,
      hasResults,
      hasFiles,
      stagedFile,
      stagedDims,
    ],
  );

  return (
    <UpscalerContext.Provider value={value}>{children}</UpscalerContext.Provider>
  );
}
