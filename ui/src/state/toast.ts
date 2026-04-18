import { create } from "zustand";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
}

interface ToastStore {
  items: ToastItem[];
  push: (kind: ToastKind, message: string, ttlMs?: number) => void;
  dismiss: (id: string) => void;
}

function uid(): string {
  return `t_${Math.random().toString(36).slice(2, 10)}`;
}

export const useToasts = create<ToastStore>((set, get) => ({
  items: [],
  push: (kind, message, ttlMs = 3500) => {
    const id = uid();
    const item: ToastItem = { id, kind, message, createdAt: Date.now() };
    set((s) => ({ items: [...s.items, item] }));
    window.setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export function toast(kind: ToastKind, message: string, ttlMs?: number) {
  useToasts.getState().push(kind, message, ttlMs);
}
