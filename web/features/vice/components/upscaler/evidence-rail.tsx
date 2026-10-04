"use client";

import { memo } from "react";
import { MAX_STREAM_MP } from "../../../../lib/limits";
import { useDeviceCapMp } from "../../hooks/use-device-cap";
import { useUpscaler } from "./upscaler-context";

export const EvidenceRail = memo(function EvidenceRail() {
  const { job, hasResults, selectedResult, hasFiles, stagedDims } = useUpscaler();
  const capMp = useDeviceCapMp();

  let body: React.ReactNode;
  if (job.error !== "") {
    body = (
      <div role="alert" className="flex w-full items-center justify-between gap-3">
        <span className="truncate font-medium text-error">{job.error}</span>
        <button
          type="button"
          onClick={job.run}
          className="shrink-0 font-medium text-foreground underline underline-offset-4 hover:opacity-80"
        >
          Retry
        </button>
      </div>
    );
  } else if (job.running) {
    body = (
      <span aria-live="polite">
        Processing · {job.progress === "" ? "starting…" : job.progress}
      </span>
    );
  } else if (hasResults && selectedResult) {
    const r = selectedResult;
    body = (
      <span className="truncate">
        Original → {r.scale}× → {r.outW}×{r.outH} · residual {r.residual.toExponential(1)} ·{" "}
        {r.durationMs}ms · {r.backend} · {r.hasIcc ? "ICC preserved" : "no ICC profile"}
      </span>
    );
  } else if (hasFiles && stagedDims) {
    const ow = stagedDims.w * job.scale;
    const oh = stagedDims.h * job.scale;
    const mp = (ow * oh) / 1_000_000;
    body = (
      <span className="truncate">
        Original {stagedDims.w}×{stagedDims.h} → {job.scale}× → {ow}×{oh} ·{" "}
        {mp.toFixed(1)} MP of {capMp.toFixed(0)} MP
      </span>
    );
  } else {
    body = (
      <span className="truncate">
        PNG · JPEG · WebP · processed on this device · up to {MAX_STREAM_MP} MP
      </span>
    );
  }

  return (
    <div className="flex h-9 shrink-0 items-center overflow-hidden border-t border-hairline/60 px-4 font-mono text-[11px] tabular-nums text-muted">
      {body}
    </div>
  );
});
