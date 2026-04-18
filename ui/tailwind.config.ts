import type { Config } from "tailwindcss";

/**
 * Upiqlo palette.
 *
 * All colour tokens are backed by CSS custom properties declared in
 * `src/index.css`. That lets the Settings Modal flip the active theme
 * (Light / Dark / System) by toggling a class on <html> — the same
 * Tailwind utility classes (`bg-surface`, `text-text-muted`, …) keep
 * working unchanged.
 *
 * Source palette: FR-IQA-Algo/web/public/static/css/tokens.css.
 */

function v(name: string) {
  return `rgb(var(${name}) / <alpha-value>)`;
}

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: v("--u-surface"),
          raised: v("--u-surface-raised"),
          sunken: v("--u-surface-sunken"),
          nested: v("--u-surface-nested"),
          hover: v("--u-surface-hover"),
          border: v("--u-surface-border"),
          "border-strong": v("--u-surface-border-strong"),
        },
        accent: {
          DEFAULT: v("--u-accent"),
          hot: v("--u-accent-hot"),
          soft: "rgba(122, 55, 49, 0.14)",
          ring: "rgba(122, 55, 49, 0.35)",
          contrast: v("--u-accent-contrast"),
        },
        text: {
          DEFAULT: v("--u-text"),
          muted: v("--u-text-muted"),
          faint: v("--u-text-faint"),
          dim: v("--u-text-dim"),
        },
        signal: {
          success: v("--u-signal-success"),
          warning: v("--u-signal-warning"),
          danger: v("--u-signal-danger"),
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SF Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "modal-in": {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "toast-in": {
          "0%": { opacity: "0", transform: "translateX(20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "tab-in": {
          "0%": { opacity: "0", transform: "translateY(2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "dropdown-in": {
          // Plain keyframe for popovers that use `right-0`, `left-0`
          // or are otherwise anchored without a -translate-x-1/2.
          "0%": { opacity: "0", transform: "translateY(-4px) scaleY(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scaleY(1)" },
        },
        "dropdown-in-centered": {
          // Variant that preserves the translateX(-50%) used by the
          // Output pane's LayerDropdown — without this the menu would
          // jump from the right edge of its trigger to centre when
          // the animation ends.
          "0%": { opacity: "0", transform: "translateX(-50%) translateY(-4px) scaleY(0.96)" },
          "100%": { opacity: "1", transform: "translateX(-50%) translateY(0) scaleY(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 120ms ease-out",
        "modal-in": "modal-in 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        "toast-in": "toast-in 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        "tab-in": "tab-in 140ms ease-out",
        "dropdown-in": "dropdown-in 120ms cubic-bezier(0.22, 1, 0.36, 1)",
        "dropdown-in-centered": "dropdown-in-centered 120ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
