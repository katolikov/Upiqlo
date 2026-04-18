import type { Config } from "tailwindcss";

/**
 * Upiqlo palette — extracted verbatim from the FR-IQA-Algo web version
 * (FR-IQA-Algo/web/public/static/css/tokens.css).
 *
 * Author's own names for the accents:
 *   - Faded Brick      #7A3731  (primary accent, used sparingly)
 *   - Weathered Timber #3E3129  (hover / selected surfaces)
 *   - Cold Concrete    #8C9295  (muted text)
 *   - Oxidized Iron    #5E3A23  (secondary accent, hot side)
 *   - Barren Earth     #635B4C  (neutral drab fill)
 *
 * Surfaces are warm near-black (#1a1612 → #3E3129) rather than cool blue,
 * giving the app the same muted/earthy feel as the upstream web viewer.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#1a1612", // page background (warm near-black)
          raised: "#221c17", // card / panel
          sunken: "#08090c", // deepest background — matches <meta theme-color>
          nested: "#2d261f", // inner surfaces (inputs, sub-panes)
          hover: "#3E3129", // hover / selected — Weathered Timber
          border: "#322a23", // hairline
          "border-strong": "#4a3d33", // hairline-strong
        },
        accent: {
          DEFAULT: "#7A3731", // Faded Brick
          hot: "#5E3A23", // Oxidized Iron
          soft: "rgba(122, 55, 49, 0.14)",
          ring: "rgba(122, 55, 49, 0.35)",
          contrast: "#f7f2e8",
        },
        text: {
          DEFAULT: "#ede6d9", // warm near-white
          muted: "#b8b0a3", // secondary
          faint: "#8C9295", // Cold Concrete
          dim: "#635B4C", // Barren Earth
        },
        // Semantic state colors, lifted verbatim from tokens.css.
        signal: {
          success: "#7f8f5e",
          warning: "#b08953",
          danger: "#7A3731",
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
    },
  },
  plugins: [],
} satisfies Config;
