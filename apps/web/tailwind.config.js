/** @type {import('tailwindcss').Config} */
const token = (name) => `oklch(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    fontSize: {
      12: ["12px", { lineHeight: "16px" }],
      13: ["13px", { lineHeight: "20px" }],
      14: ["14px", { lineHeight: "20px" }],
      16: ["16px", { lineHeight: "24px" }],
      20: ["20px", { lineHeight: "28px" }],
    },
    fontWeight: {
      normal: "400",
      medium: "500",
      semibold: "600",
    },
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        hover: token("hover"),
        selected: token("selected"),
        line: token("line"),
        "line-strong": token("line-strong"),
        fg: token("fg"),
        subtle: token("subtle"),
        faint: token("faint"),
        accent: token("accent"),
        "accent-fg": token("accent-fg"),
        approve: token("approve"),
        review: token("review"),
        reject: token("reject"),
        info: token("info"),
        "approve-tint": token("approve-tint"),
        "review-tint": token("review-tint"),
        "reject-tint": token("reject-tint"),
        "info-tint": token("info-tint"),
      },
      borderColor: {
        DEFAULT: token("line"),
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "4px",
        md: "6px",
      },
      fontFamily: {
        sans: [
          '"IBM Plex Sans"',
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        float: "0 1px 2px oklch(0 0 0 / 0.06), 0 8px 24px -4px oklch(0 0 0 / 0.14)",
      },
    },
  },
  plugins: [],
};
