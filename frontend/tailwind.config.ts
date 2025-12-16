import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#060a15",
        "background-2": "#0a1224",
        panel: "#0d1930",
        "panel-strong": "#132340",
        border: "rgba(255, 255, 255, 0.08)",
        muted: "#99a7c2",
        foreground: "#ecf3ff",
        accent: "#7fe8c3",
        "accent-2": "#ffb36b",
        danger: "#ff6b6b",
        success: "#7ce7a7",
      },
      borderRadius: {
        soft: "14px",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        panel: "0 15px 40px rgba(0,0,0,0.35)",
      },
      backgroundImage: {
        "app-grid":
          "radial-gradient(circle at 10% 20%, rgba(127,232,195,0.08), transparent 28%), radial-gradient(circle at 80% 0%, rgba(255,179,107,0.08), transparent 32%), linear-gradient(145deg, #060a15, #0a1224)",
      },
      keyframes: {
        draw: {
          to: { strokeDashoffset: "0" },
        },
      },
      animation: {
        draw: "draw 0.5s ease forwards",
      },
    },
  },
  plugins: [],
};

export default config;
