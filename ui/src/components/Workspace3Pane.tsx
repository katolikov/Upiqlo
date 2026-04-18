import { useEffect, useState } from "react";
import { ImagePane } from "./ImagePane";
import { MiddlePaneTabs } from "./MiddlePaneTabs";
import { heatmapDataUrl } from "@/lib/api";
import { resolveImageSrc } from "@/lib/assets";
import { useSessions, type CompareStatus, type HeatmapLayer } from "@/state/sessions";
import type { CompareReport } from "@/types/report";

interface Props {
  sessionId: string;
  referencePath: string | null;
  targetPath: string | null;
  status: CompareStatus;
  layer: HeatmapLayer;
}

export function Workspace3Pane({
  sessionId,
  referencePath,
  targetPath,
  status,
  layer,
}: Props) {
  const setLayer = useSessions((s) => s.setLayer);
  const [refSrc, setRefSrc] = useState<string | null>(null);
  const [tgtSrc, setTgtSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([resolveImageSrc(referencePath), resolveImageSrc(targetPath)]).then(
      ([r, t]) => {
        if (cancelled) return;
        setRefSrc(r);
        setTgtSrc(t);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [referencePath, targetPath]);

  const report: CompareReport | null = status.kind === "ok" ? status.report : null;
  const heatmapB64 = report?.heatmaps[layer] ?? null;
  const middleSrc = heatmapB64 ? heatmapDataUrl(heatmapB64) : null;
  const available = new Set(Object.keys(report?.heatmaps ?? {}));

  const middlePlaceholder =
    status.kind === "running"
      ? status.stage
        ? `Stage ${status.stage.index}/${status.stage.total} · ${status.stage.name}`
        : "Starting engine…"
      : status.kind === "error"
        ? `Error: ${status.message}`
        : status.kind === "cancelled"
          ? "Comparison cancelled. Click Compare to retry."
          : "Run a comparison to see heatmaps";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <MiddlePaneTabs
        value={layer}
        onChange={(l) => setLayer(sessionId, l)}
        available={available}
      />
      <div className="flex-1 flex min-h-0">
        <ImagePane
          sessionId={sessionId}
          src={refSrc}
          label="A · Reference"
          placeholder="Pick a reference image"
          className="border-r border-surface-border"
        />
        <ImagePane
          sessionId={sessionId}
          src={middleSrc}
          label={`Output · ${layer.replace(/_/g, " ").replace(/\.png$/, "")}`}
          placeholder={middlePlaceholder}
          className="border-r border-surface-border"
        />
        <ImagePane
          sessionId={sessionId}
          src={tgtSrc}
          label="B · Target"
          placeholder="Pick a target image"
        />
      </div>
    </div>
  );
}
