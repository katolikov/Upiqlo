import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToasts, type ToastItem } from "@/state/toast";

export function Toasts() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <ToastRow key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [Icon, cls] = pickStyle(item.kind);

  useEffect(() => {
    // Purely decorative; the store handles timing.
  }, []);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md",
        "border shadow-md backdrop-blur bg-surface-raised/95 text-[12px] min-w-[220px] max-w-[380px]",
        "animate-toast-in",
        cls,
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span className="flex-1 truncate">{item.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="p-0.5 rounded text-text-faint hover:text-text hover:bg-surface"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function pickStyle(kind: string): [typeof Info, string] {
  switch (kind) {
    case "success":
      return [CheckCircle2, "border-signal-success/40 text-signal-success"];
    case "error":
      return [AlertCircle, "border-signal-danger/50 text-signal-danger"];
    case "warning":
      return [AlertCircle, "border-signal-warning/40 text-signal-warning"];
    default:
      return [Info, "border-surface-border-strong text-text"];
  }
}
