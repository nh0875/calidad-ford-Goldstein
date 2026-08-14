import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { cargarMarca } from "./lib/marca";
import "./index.css";

// Se consulta la marca ANTES de dibujar: si se dibujara primero y se corrigiera
// después, en Volkswagen se verían por un instante las pestañas de Fidelización
// (que esa marca no usa) y el nombre de la otra marca. Es un pedido local y
// rápido, y si falla `cargarMarca` cae al default (Ford) sin romper nada.
cargarMarca().then((marca) => {
  document.title = `Calidad | ${marca.nombre}`;
  // Dispara la paleta de la marca (ver index.css). Va ANTES de dibujar para que
  // no se vea un parpadeo con los colores de la otra marca.
  document.documentElement.dataset.marca = marca.codigo;
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
