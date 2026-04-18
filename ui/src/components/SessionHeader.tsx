import { cn } from "@/lib/utils";
import { PathInput } from "./PathInput";

/**
 * Dual-slot session header with an A input on the far left and a B
 * input on the far right, separated by a flexible middle region.
 * Used by both File Compare and Folder Compare modes.
 */
export function SessionHeader({
  leftValue,
  onCommitLeft,
  rightValue,
  onCommitRight,
  kind,
  leftLabel = "A",
  rightLabel = "B",
  middle,
  className,
}: {
  leftValue: string | null;
  onCommitLeft: (p: string) => void;
  rightValue: string | null;
  onCommitRight: (p: string) => void;
  kind: "file" | "directory";
  leftLabel?: string;
  rightLabel?: string;
  middle?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-11 border-b border-surface-border bg-surface flex items-stretch gap-0 shrink-0",
        className,
      )}
    >
      <div className="flex-1 min-w-0 flex items-center px-2 border-r border-surface-border">
        <PathInput
          label={leftLabel}
          value={leftValue}
          onCommit={onCommitLeft}
          kind={kind}
          className="w-full"
          pickerTitle={
            kind === "file"
              ? `Select reference image (${leftLabel})`
              : `Select reference folder (${leftLabel})`
          }
        />
      </div>

      <div className="flex-1 min-w-0 flex items-center justify-center px-2 border-r border-surface-border">
        {middle}
      </div>

      <div className="flex-1 min-w-0 flex items-center px-2">
        <PathInput
          label={rightLabel}
          value={rightValue}
          onCommit={onCommitRight}
          kind={kind}
          className="w-full"
          pickerTitle={
            kind === "file"
              ? `Select target image (${rightLabel})`
              : `Select target folder (${rightLabel})`
          }
        />
      </div>
    </div>
  );
}
