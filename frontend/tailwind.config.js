/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Azul marino: color de marca, evoca precisión técnica de taller sin copiar
        // la identidad visual de Ford.
        navy: {
          DEFAULT: "#0B2545",
          dark: "#071A33",
          light: "#173867",
        },
        // Celeste: acento interactivo (botones, links, foco). "accent-dark" es la
        // variante con contraste suficiente para texto de cuerpo (AA); "accent" se
        // usa para fondos, íconos y elementos grandes.
        accent: {
          DEFAULT: "#3E7CB1",
          dark: "#2F6690",
          light: "#EAF2F8",
        },
        canvas: "#F7F8FA",
        ink: {
          DEFAULT: "#1C2530",
          muted: "#5B6472",
        },
        // Trío de semáforo ya validado (no modificar): también se usa fuera de
        // graficos.tsx para badges y puntos de estado en listados.
        semaforo: {
          verde: "#0ca30c",
          amarillo: "#fab219",
          rojo: "#d03b3b",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Sora", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      keyframes: {
        "fade-slide-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        "fade-slide-in": "fade-slide-in 0.35s ease-out",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
