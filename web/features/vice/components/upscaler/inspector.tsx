"use client";

import { memo } from "react";
import { useDeviceStreamCapMp } from "../../hooks/use-device-cap";
import type { ViceScale } from "../../types/vice";
import { useUpscaler } from "./upscaler-context";
import { SpinnerIcon } from "../studio-icons";

function StreamExportAction({
  running,
  disabled,
  onClick,
  scale,
  outMp,
}: {
  running: boolean;
  disabled?: boolean;
  onClick: () => void;
  scale: number;
  outMp?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={running || disabled}
        className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 text-xs font-semibold text-background transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
      >
        {running && <SpinnerIcon className="h-3 w-3 animate-spin" />}
        <span>Choose destination &amp; upscale</span>
      </button>
      <div className="text-[11px] text-muted">
        {scale}× output {outMp?.toFixed(1)} MP streams straight to disk — no memory cap, preview only in-app.
      </div>
    </div>
  );
}

function BatchExportAction({
  running,
  disabled,
  onClick,
  fileCount,
}: {
  running: boolean;
  disabled?: boolean;
  onClick: () => void;
  fileCount: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={running || disabled}
        className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 text-xs font-semibold text-background transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
      >
        {running && <SpinnerIcon className="h-3 w-3 animate-spin" />}
        <span>Choose folder &amp; upscale {fileCount}</span>
      </button>
      <div className="text-[11px] text-muted">
        Each file streams to its own PNG — no memory cap, previews only in-app.
      </div>
    </div>
  );
}

const SCALES: readonly ViceScale[] = [2, 3, 4];

function UpscaleButton({ full }: { full?: boolean }) {
  const { job } = useUpscaler();
  const label = job.running
    ? "Upscaling…"
    : job.files.length > 1
      ? `Upscale ${job.files.length}`
      : "Upscale";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={job.run}
        disabled={job.running}
        className={`inline-flex h-8 items-center justify-center gap-2 rounded-md bg-foreground px-4 text-xs font-semibold text-background transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-40 ${
          full ? "w-full" : ""
        }`}
      >
        {job.running && <SpinnerIcon className="h-3 w-3 animate-spin" />}
        <span>{label}</span>
      </button>
      {job.running && (
        <button
          type="button"
          onClick={job.cancel}
          className="inline-flex h-8 items-center rounded-md border border-hairline px-3 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onPick,
  disabled,
  format,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onPick: (v: T) => void;
  disabled?: boolean;
  format?: (v: T) => string;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div
        role="group"
        aria-label={label}
        className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-md border border-hairline bg-foreground/[0.03] p-0.5"
      >
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            disabled={disabled}
            onClick={() => onPick(o)}
            aria-pressed={value === o}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              value === o
                ? "bg-foreground font-semibold text-background"
                : "text-muted hover:text-foreground disabled:opacity-40"
            }`}
          >
            {format ? format(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

function InspectorStaged() {
  const { job, stagedDims } = useUpscaler();
  const streamCapMp = useDeviceStreamCapMp();
  const outMp =
    stagedDims != null ? (stagedDims.w * job.scale * (stagedDims.h * job.scale)) / 1_000_000 : null;
  const overStreamCap = outMp != null && outMp > streamCapMp;
  const singleFile = job.files.length === 1;
  const canSave = overStreamCap && singleFile && job.canSaveToDisk;
  const canSaveBatch = overStreamCap && !singleFile && job.canPickDirectory;

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label="Upscale factor"
        options={SCALES}
        value={job.scale}
        onPick={job.setScale}
        disabled={job.running}
        format={(s) => `${s}×`}
      />

      {job.scale === 4 && (
        <Segmented
          label="4x pass mode"
          options={["direct", "chained"] as const}
          value={job.chained4x ? "chained" : "direct"}
          onPick={(v) => job.setChained4x(v === "chained")}
          disabled={job.running}
          format={(v) => (v === "direct" ? "Direct" : "2××2×")}
        />
      )}

      <div
        aria-live="polite"
        className={`font-mono text-[11px] tabular-nums ${overStreamCap ? "font-semibold text-error" : "text-muted"}`}
      >
        {outMp != null
          ? overStreamCap
            ? `${job.scale}× output: ${outMp.toFixed(1)} MP exceeds this device's ${streamCapMp.toFixed(0)} MP in-browser limit.`
            : `${job.scale}× output: ${outMp.toFixed(1)} MP · memory-bounded streaming.`
          : "Staging preview…"}
      </div>

      {overStreamCap ? (
        canSave ? (
          <StreamExportAction
            running={job.running}
            onClick={() => void job.runToFile()}
            scale={job.scale}
            outMp={outMp}
          />
        ) : canSaveBatch ? (
          <BatchExportAction
            running={job.running}
            onClick={() => void job.runBatchToFolder()}
            fileCount={job.files.length}
          />
        ) : (
          <div className="text-xs text-error">
            {singleFile
              ? "Over this device's in-browser limit. Large exports require Chrome/Edge desktop or Vice Desktop."
              : "Over this device's in-browser limit. Folder export requires Chrome/Edge desktop or Vice Desktop."}
          </div>
        )
      ) : (
        <UpscaleButton full />
      )}
    </div>
  );
}

function InspectorResult() {
  const { selectedResult } = useUpscaler();
  if (!selectedResult) return null;
  const r = selectedResult;
  const rows: [string, string][] = [
    ["Output", `${r.outW}×${r.outH}`],
    ["Engine", r.threads != null && r.threads > 1 ? `${r.backend} · T${r.threads}` : r.backend],
    ["Residual", r.residual.toExponential(1)],
    ["Time", `${r.durationMs}ms`],
    ["ICC", r.hasIcc ? "Preserved" : "Absent"],
    ...(r.savedToDisk
      ? ([
          ["Saved", r.fileName ?? "on disk"],
          [
            "File size",
            r.fileBytes != null ? `${(r.fileBytes / 1_048_576).toFixed(1)} MB` : "—",
          ],
        ] as [string, string][])
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="font-mono text-xs text-foreground">
        Done in {r.durationMs}ms
      </div>
      <dl className="flex flex-col gap-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="text-muted">{k}</dt>
            <dd className="truncate font-mono tabular-nums text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      <UpscaleButton full />
    </div>
  );
}

export const InspectorContent = memo(function InspectorContent() {
  const { hasResults, hasFiles } = useUpscaler();
  return (
    <div className="flex flex-col gap-4">
      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        Output
      </div>
      {hasResults ? <InspectorResult /> : hasFiles ? <InspectorStaged /> : null}
    </div>
  );
});

export const InspectorRail = memo(function InspectorRail() {
  const { hasResults, hasFiles } = useUpscaler();
  if (!hasResults && !hasFiles) return null;
  return (
    <aside
      aria-label="Output settings"
      className="hidden w-[var(--rail-r)] shrink-0 flex-col gap-4 overflow-y-auto border-l border-hairline/60 px-4 py-4 lg:flex"
    >
      <InspectorContent />
    </aside>
  );
});
