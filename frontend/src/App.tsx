import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "./layouts/MainLayout";
import RutaPrivada from "./components/RutaPrivada";
import Login from "./pages/Login";
import CambiarPassword from "./pages/CambiarPassword";
import Dashboard from "./pages/Dashboard";
import Upload from "./pages/Upload";
import Casos from "./pages/Casos";
import ReporteSentimiento from "./pages/ReporteSentimiento";
import ReporteCausasRaiz from "./pages/ReporteCausasRaiz";
import Rqr from "./pages/Rqr";
import Seguimiento from "./pages/Seguimiento";
import RqrDetalle from "./pages/RqrDetalle";
import RqrNuevo from "./pages/RqrNuevo";
import Usuarios from "./pages/Usuarios";
import Auditoria from "./pages/Auditoria";
import Configuracion from "./pages/Configuracion";
import Refuerzos from "./pages/Refuerzos";
import Fidelizacion from "./pages/Fidelizacion";
import ClientesFidelizacion from "./pages/ClientesFidelizacion";
import Supresion from "./pages/Supresion";
import Normalizacion from "./pages/Normalizacion";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RutaPrivada>
              <MainLayout />
            </RutaPrivada>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/casos" element={<Casos />} />
          <Route path="/reportes/sentimiento" element={<ReporteSentimiento />} />
          <Route path="/reportes/causas-raiz" element={<ReporteCausasRaiz />} />
          <Route path="/seguimiento" element={<Seguimiento />} />
          {/* Link viejo: se mantiene y redirige al nuevo chat de Seguimiento */}
          <Route path="/revision-manual" element={<Navigate to="/seguimiento" replace />} />
          <Route path="/rqr" element={<Rqr />} />
          <Route path="/rqr/nuevo" element={<RqrNuevo />} />
          <Route path="/refuerzos" element={<Refuerzos />} />
          <Route path="/fidelizacion" element={<Fidelizacion />} />
          <Route path="/fidelizacion/clientes" element={<ClientesFidelizacion />} />
          <Route path="/rqr/:id" element={<RqrDetalle />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="/supresion" element={<Supresion />} />
          <Route path="/normalizacion" element={<Normalizacion />} />
          <Route path="/auditoria" element={<Auditoria />} />
          <Route path="/configuracion" element={<Configuracion />} />
          <Route path="/cambiar-password" element={<CambiarPassword />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
