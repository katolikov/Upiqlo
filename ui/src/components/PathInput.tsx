import { useEffect, useState } from "react";
import { FileImage, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { pickDirectory, pickImageFile } from "@/lib/pickers";

interface Props {
  label: string;
  value: string | null;
  onCommit: (path: string) => void;
  kind: "file" | "directory";
  placeholder?: string;
  className?: string;
  /** Title-cased description shown in the native picker title bar. */
  pickerTitle?: string;
}

/**
 * Editable text field for an absolute filesystem path. The user can:
 *   - type / paste a path and press Enter to commit,
 *   - click the inline folder/file icon to open the native picker,
 *   - unfocus (blur) to commit the current text.
 *
 * `onCommit` is called only when the path actually changes.
 */
export function PathInput({
  label,
  value,
  onCommit,
  kind,
  placeholder,
  className,
  pickerTitle,
}: Props) {
  const [text, setText] = useState(value ?? "");

  // Keep the local text in sync when the store value changes from outside.
  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  const commit = (s: string) => {
    const trimmed = s.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
  };

  const pick = async () => {
    const p =
      kind === "directory"
        ? await pickDirectory(pickerTitle ?? `Select ${label}`)
        : await pickImageFile(pickerTitle ?? `Select ${label}`);
    if (p) {
      setText(p);
      onCommit(p);
    }
  };

  const Icon = kind === "directory" ? FolderOpen : FileImage;

  return (
    <label
      className={cn(
        "flex items-center gap-2 px-2 py-1 rounded-md border border-surface-border bg-surface-raised/80 focus-within:border-accent/60",
        className,
      )}
    >
      <span className="text-[10px] uppercase tracking-wider text-text-faint shrink-0 font-medium">
        {label}
      </span>
      <input
        type="text"
        value={text}
        spellCheck={false}
        placeholder={placeholder ?? (kind === "directory" ? "/absolute/path/to/folder" : "/absolute/path/to/file.png")}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(text);
          } else if (e.key === "Escape") {
            setText(value ?? "");
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="flex-1 min-w-0 bg-transparent text-text text-[12px] outline-none placeholder:text-text-faint"
      />
      <button
        type="button"
        onClick={pick}
        className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-text-muted hover:text-text hover:bg-surface-hover border border-transparent hover:border-surface-border"
        title={`Browse for ${kind === "directory" ? "folder" : "file"}`}
      >
        <Icon size={13} />
      </button>
    </label>
  );
}
