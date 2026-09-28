/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        gy: {
          dark: "#0b0e14",
          card: "#121824",
          cardHover: "#182234",
          border: "#1f2d44",
          accent: "#22c55e",
          accentHover: "#16a34a",
          secondary: "#38bdf8",
          warning: "#f59e0b",
          danger: "#ef4444"
        }
      }
    },
  },
  plugins: [],
}
