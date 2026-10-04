"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ViceResult } from "../../types/vice";
import type { CompareMode, PixelMode, ViewportDimensions } from "./comparison-types";

export interface ComparisonContextValue {
  result: ViceResult;
  allResults: ViceResult[];
  onSelectId: (id: number) => void;
  pos: number;
  setPos: (p: number) => void;
  zoom: number;
  setZoom: (z: number) => void;
  mode: CompareMode;
  setMode: (m: CompareMode) => void;
  isHoldingBefore: boolean;
  viewportSize: ViewportDimensions;
  pixelMode: PixelMode;
  setPixelMode: React.Dispatch<React.SetStateAction<PixelMode>>;
  viewportRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  origW: number;
  origH: number;
  stageW: number;
  stageH: number;
  panelW: number;
  panelH: number;
  panelGap: number;
  zoom1to1: number;
  is1to1: boolean;
  isPixelated: boolean;
  imageRenderingClass: string;
  effectivePos: number;
  isSliderOffLeft: boolean;
  isSliderOffRight: boolean;
  isSliderOffscreen: boolean;
  applyZoom: (newZoom: number, focalClientX?: number, focalClientY?: number) => void;
  bringSliderToView: () => void;
  onWheel: (e: React.WheelEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onHandlePointerDown: (e: React.PointerEvent) => void;
  onHandlePointerMove: (e: React.PointerEvent) => void;
  onHandlePointerUp: (e: React.PointerEvent) => void;
  onViewportPointerDown: (e: React.PointerEvent) => void;
  onViewportPointerMove: (e: React.PointerEvent) => void;
  onViewportPointerUp: (e: React.PointerEvent) => void;
  onViewportScroll: () => void;
}

const ComparisonContext = createContext<ComparisonContextValue | null>(null);

export function useComparison(): ComparisonContextValue {
  const ctx = useContext(ComparisonContext);
  if (!ctx) {
    throw new Error(
      "Comparison compound components must be used within a <Comparison.Root />",
    );
  }
  return ctx;
}

interface ComparisonProviderProps {
  result: ViceResult;
  allResults?: ViceResult[];
  onSelectId?: (id: number) => void;
  children: ReactNode;
}

export function ComparisonProvider({
  result,
  allResults = [],
  onSelectId = () => {},
  children,
}: ComparisonProviderProps) {
  // Pure local interactive state (resets cleanly when key={result.id} remounts)
  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<CompareMode>("split");
  const [isHoldingBefore, setIsHoldingBefore] = useState(false);
  const [viewportSize, setViewportSize] = useState<ViewportDimensions>({
    width: 0,
    height: 0,
  });
  const [pixelMode, setPixelMode] = useState<PixelMode>("auto");

  // DOM Refs for drag & gesture tracking without trigger re-renders
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const isDraggingHandleRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const [sliderOffscreen, setSliderOffscreen] = useState<{
    isSliderOffLeft: boolean;
    isSliderOffRight: boolean;
  }>({
    isSliderOffLeft: false,
    isSliderOffRight: false,
  });

  // Pure derived calculations during render (no redundant state)
  const origW = Math.round(result.outW / result.scale);
  const origH = Math.round(result.outH / result.scale);
  const imgAspect = (result.outW || 1) / (result.outH || 1);

  // Synchronizing with external ResizeObserver (proper cleanup)
  useEffect(() => {
    if (!viewportRef.current) return;
    const el = viewportRef.current;
    const updateSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setViewportSize({ width: w, height: h });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Viewport layout calculations
  const availW = Math.max(60, (viewportSize.width || 1200) - 32);
  const availH = Math.max(60, (viewportSize.height || 800) - 32);
  const availAspect = availW / availH;

  // Split mode base dimensions
  let baseW: number;
  let baseH: number;
  if (availAspect > imgAspect) {
    baseH = availH;
    baseW = baseH * imgAspect;
  } else {
    baseW = availW;
    baseH = baseW / imgAspect;
  }
  const stageW = Math.max(20, Math.round(baseW * zoom));
  const stageH = Math.max(20, Math.round(baseH * zoom));
  const zoom1to1 = baseW > 0 ? Math.max(1, Math.round((result.outW / baseW) * 100) / 100) : 1;
  const is1to1 = Math.abs(zoom - zoom1to1) < 0.05;

  // Pixel inspection evaluation
  const isPixelated =
    pixelMode === "crisp" ||
    (pixelMode === "auto" && (zoom >= 2 || (zoom >= zoom1to1 && zoom > 1.2)));

  const imageRenderingClass = isPixelated
    ? "pointer-events-none absolute inset-0 h-full w-full object-fill [image-rendering:pixelated]"
    : "pointer-events-none absolute inset-0 h-full w-full object-fill";

  // Side-by-Side base dimensions
  const panelGap = 16;
  const panelAvailW = Math.max(30, (availW - panelGap) / 2);
  const panelAvailH = availH;
  const panelAvailAspect = panelAvailW / panelAvailH;

  let panelBaseW: number;
  let panelBaseH: number;
  if (panelAvailAspect > imgAspect) {
    panelBaseH = panelAvailH;
    panelBaseW = panelBaseH * imgAspect;
  } else {
    panelBaseW = panelAvailW;
    panelBaseH = panelBaseW / imgAspect;
  }
  const panelW = Math.max(20, Math.round(panelBaseW * zoom));
  const panelH = Math.max(20, Math.round(panelBaseH * zoom));

  const updateSliderOffscreen = useCallback((overridePos?: number) => {
    if (!viewportRef.current || !stageRef.current || zoom <= 1 || mode !== "split") {
      setSliderOffscreen((prev) => {
        if (!prev.isSliderOffLeft && !prev.isSliderOffRight) return prev;
        return { isSliderOffLeft: false, isSliderOffRight: false };
      });
      return;
    }

    const vp = viewportRef.current;
    const stage = stageRef.current;
    const vpRect = vp.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (stageRect.width <= 0) return;

    const activePos = overridePos ?? pos;
    const sliderClientX = stageRect.left + (activePos / 100) * stageRect.width;

    // Grab handle is 36px wide (18px radius). Consider off-screen when handle edge is past viewport bounds.
    const offLeft = sliderClientX < vpRect.left + 18;
    const offRight = sliderClientX > vpRect.right - 18;

    setSliderOffscreen((prev) => {
      if (prev.isSliderOffLeft === offLeft && prev.isSliderOffRight === offRight) {
        return prev;
      }
      return { isSliderOffLeft: offLeft, isSliderOffRight: offRight };
    });
  }, [zoom, mode, pos]);

  const updateSplitPos = useCallback((clientX: number) => {
    if (!stageRef.current) return;
    const stageRect = stageRef.current.getBoundingClientRect();
    if (stageRect.width <= 0) return;
    const offset = clientX - stageRect.left;
    const pct = Math.max(0, Math.min(100, (offset / stageRect.width) * 100));
    const rounded = Math.round(pct * 10) / 10;
    setPos(rounded);
    updateSliderOffscreen(rounded);
  }, [updateSliderOffscreen]);

  const bringSliderToView = useCallback(() => {
    if (!viewportRef.current || !stageRef.current) return;
    const vp = viewportRef.current;
    const stage = stageRef.current;
    const vpRect = vp.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (stageRect.width <= 0) return;
    const visibleCenterX = vpRect.left + vpRect.width / 2;
    const offset = visibleCenterX - stageRect.left;
    const pct = Math.max(5, Math.min(95, (offset / stageRect.width) * 100));
    const rounded = Math.round(pct * 10) / 10;
    setPos(rounded);
    setSliderOffscreen({ isSliderOffLeft: false, isSliderOffRight: false });
  }, []);

  const applyZoom = useCallback(
    (newZoom: number, focalClientX?: number, focalClientY?: number) => {
      const vp = viewportRef.current;
      const stage = stageRef.current;
      const clampedZoom = Math.max(1, Math.min(16, Math.round(newZoom * 100) / 100));

      if (!vp || !stage) {
        setZoom(clampedZoom);
        return;
      }

      if (clampedZoom === 1) {
        setZoom(1);
        requestAnimationFrame(() => {
          vp.scrollLeft = 0;
          vp.scrollTop = 0;
          setSliderOffscreen({ isSliderOffLeft: false, isSliderOffRight: false });
        });
        return;
      }

      const vpRect = vp.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();

      const fx = focalClientX ?? vpRect.left + vpRect.width / 2;
      const fy = focalClientY ?? vpRect.top + vpRect.height / 2;

      const normX =
        stageRect.width > 0
          ? Math.max(0, Math.min(1, (fx - stageRect.left) / stageRect.width))
          : 0.5;
      const normY =
        stageRect.height > 0
          ? Math.max(0, Math.min(1, (fy - stageRect.top) / stageRect.height))
          : 0.5;

      setZoom(clampedZoom);

      requestAnimationFrame(() => {
        if (!stageRef.current || !viewportRef.current) return;
        const nextStage = stageRef.current;
        const nextVp = viewportRef.current;

        const targetStageW = nextStage.offsetWidth;
        const targetStageH = nextStage.offsetHeight;

        const desiredScrollLeft = normX * targetStageW - (fx - vpRect.left);
        const desiredScrollTop = normY * targetStageH - (fy - vpRect.top);

        const maxScrollLeft = Math.max(0, nextVp.scrollWidth - nextVp.clientWidth);
        const maxScrollTop = Math.max(0, nextVp.scrollHeight - nextVp.clientHeight);

        const actualScrollLeft = Math.max(0, Math.min(maxScrollLeft, desiredScrollLeft));
        const actualScrollTop = Math.max(0, Math.min(maxScrollTop, desiredScrollTop));
        nextVp.scrollLeft = actualScrollLeft;
        nextVp.scrollTop = actualScrollTop;

        if (clampedZoom > 1 && targetStageW > 0) {
          const visibleCenterX = actualScrollLeft + nextVp.clientWidth / 2;
          const newPos = Math.max(5, Math.min(95, (visibleCenterX / targetStageW) * 100));
          const rounded = Math.round(newPos * 10) / 10;
          setPos(rounded);
          setSliderOffscreen({ isSliderOffLeft: false, isSliderOffRight: false });
        }
      });
    },
    [],
  );

  // Synchronizing with window keyboard events (proper cleanup)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName || "")
      ) {
        e.preventDefault();
        setIsHoldingBefore(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsHoldingBefore(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.25 : 0.8;
      applyZoom(zoom * factor, e.clientX, e.clientY);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (zoom > 1.05) {
      applyZoom(1);
    } else {
      const targetZoom = zoom1to1 > 1.4 ? zoom1to1 : 2.5;
      applyZoom(targetZoom, e.clientX, e.clientY);
    }
  };

  const onHandlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    isDraggingHandleRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (isDraggingHandleRef.current) {
      updateSplitPos(e.clientX);
    }
  };

  const onHandlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingHandleRef.current) {
      isDraggingHandleRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (isDraggingHandleRef.current) return;
    if (zoom > 1 && viewportRef.current) {
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: viewportRef.current.scrollLeft,
        scrollTop: viewportRef.current.scrollTop,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else if (zoom === 1 && mode === "split") {
      updateSplitPos(e.clientX);
      isDraggingHandleRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onViewportPointerMove = (e: React.PointerEvent) => {
    if (isPanningRef.current && viewportRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      viewportRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      viewportRef.current.scrollTop = panStartRef.current.scrollTop - dy;
      updateSliderOffscreen();
    } else if (isDraggingHandleRef.current) {
      updateSplitPos(e.clientX);
    }
  };

  const onViewportPointerUp = (e: React.PointerEvent) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      updateSliderOffscreen();
    }
    if (isDraggingHandleRef.current) {
      isDraggingHandleRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      updateSliderOffscreen();
    }
  };

  const onViewportScroll = useCallback(() => {
    updateSliderOffscreen();
  }, [updateSliderOffscreen]);

  // Synchronize slider visibility when zoom, pos, stage size, or viewport changes
  useEffect(() => {
    updateSliderOffscreen();
  }, [updateSliderOffscreen, pos, zoom, mode, stageW, stageH, viewportSize]);

  const effectivePos = isHoldingBefore ? 100 : pos;

  const isSliderOffLeft = sliderOffscreen.isSliderOffLeft;
  const isSliderOffRight = sliderOffscreen.isSliderOffRight;
  const isSliderOffscreen = isSliderOffLeft || isSliderOffRight;

  const value = useMemo<ComparisonContextValue>(
    () => ({
      result,
      allResults,
      onSelectId,
      pos,
      setPos,
      zoom,
      setZoom,
      mode,
      setMode,
      isHoldingBefore,
      viewportSize,
      pixelMode,
      setPixelMode,
      viewportRef,
      stageRef,
      origW,
      origH,
      stageW,
      stageH,
      panelW,
      panelH,
      panelGap,
      zoom1to1,
      is1to1,
      isPixelated,
      imageRenderingClass,
      effectivePos,
      isSliderOffLeft,
      isSliderOffRight,
      isSliderOffscreen,
      applyZoom,
      bringSliderToView,
      onWheel,
      onDoubleClick,
      onHandlePointerDown,
      onHandlePointerMove,
      onHandlePointerUp,
      onViewportPointerDown,
      onViewportPointerMove,
      onViewportPointerUp,
      onViewportScroll,
    }),
    [
      result,
      allResults,
      onSelectId,
      pos,
      zoom,
      mode,
      isHoldingBefore,
      viewportSize,
      pixelMode,
      origW,
      origH,
      stageW,
      stageH,
      panelW,
      panelH,
      panelGap,
      zoom1to1,
      is1to1,
      isPixelated,
      imageRenderingClass,
      effectivePos,
      isSliderOffLeft,
      isSliderOffRight,
      isSliderOffscreen,
      applyZoom,
      bringSliderToView,
      onViewportScroll,
    ],
  );

  return (
    <ComparisonContext.Provider value={value}>
      {children}
    </ComparisonContext.Provider>
  );
}
