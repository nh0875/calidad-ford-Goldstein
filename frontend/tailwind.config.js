/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ---------------------------------------------------------------------
        // COLORES DE MARCA — se resuelven en tiempo de ejecución
        // ---------------------------------------------------------------------
        // Cada marca corre su propia copia del sistema y tiene que verse distinta,
        // pero Tailwind compila las clases UNA sola vez en el build. Por eso el
        // valor no se escribe acá sino que sale de una variable CSS que se define
        // en index.css según la marca (atributo data-marca en <html>).
        //
        // El formato `rgb(var(--x) / <alpha-value>)` NO es capricho: es lo que
        // permite que sigan funcionando los modificadores de opacidad que ya usa
        // el código (bg-navy/50 en los modales, border-accent/30 en los avisos).
        // Con un `var(--x)` pelado, esas clases dejarían de aplicar el color.
        navy: {
          DEFAULT: "rgb(var(--color-navy) / <alpha-value>)",
          dark: "rgb(var(--color-navy-dark) / <alpha-value>)",
          light: "rgb(var(--color-navy-light) / <alpha-value>)",
        },
        // Acento interactivo (botones, links, foco). "accent-dark" es la variante
        // con contraste suficiente para texto de cuerpo (AA); "accent" se usa para
        // fondos, íconos y elementos grandes.
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          dark: "rgb(var(--color-accent-dark) / <alpha-value>)",
          light: "rgb(var(--color-accent-light) / <alpha-value>)",
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
