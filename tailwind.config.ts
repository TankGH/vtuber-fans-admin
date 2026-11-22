import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "思源黑体",
          "Source Han Sans SC",
          "Noto Sans CJK SC",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
        ink: "var(--text)",
        muted: "var(--text-muted)",
        primary: "var(--primary)",
        accent: "var(--accent)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(2, 8, 23, 0.36)",
        glow: "0 0 24px var(--glow)",
      },
      backgroundImage: {
        "galaxy-glow":
          "radial-gradient(1200px 600px at 12% -10%, var(--glow), transparent 65%)",
        "brand-gradient":
          "linear-gradient(120deg, var(--primary), var(--accent))",
      },
      keyframes: {
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "rise-in": "rise-in 320ms ease-out both",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
