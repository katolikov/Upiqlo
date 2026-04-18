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
        "h-11 border-b border-surface-border bg-surface flex items-stretch gap-2 px-2 shrink-0",
        className,
      )}
    >
      <PathInput
        label={leftLabel}
        value={leftValue}
        onCommit={onCommitLeft}
        kind={kind}
        className="w-[320px] shrink-0 self-center"
        pickerTitle={
          kind === "file"
            ? `Select reference image (${leftLabel})`
            : `Select reference folder (${leftLabel})`
        }
      />

      <div className="flex-1 flex items-center justify-center min-w-0">
        {middle}
      </div>

      <PathInput
        label={rightLabel}
        value={rightValue}
        onCommit={onCommitRight}
        kind={kind}
        className="w-[320px] shrink-0 self-center"
        pickerTitle={
          kind === "file"
            ? `Select target image (${rightLabel})`
            : `Select target folder (${rightLabel})`
        }
      />
    </div>
  );
}
