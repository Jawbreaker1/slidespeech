import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        paper: "#f7f4ed",
        coral: "#f25f4c",
        teal: "#1c7c7d",
        gold: "#f2b134",
      },
      fontFamily: {
        sans: ["Avenir Next", "Trebuchet MS", "Verdana", "sans-serif"],
        body: ["Iowan Old Style", "Palatino Linotype", "Georgia", "serif"],
      },
      boxShadow: {
        panel: "0 18px 60px rgba(15, 23, 42, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
