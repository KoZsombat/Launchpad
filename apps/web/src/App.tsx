import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { authClient } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { NewAppPage } from "./pages/NewApp";
import { AppDetailPage } from "./pages/AppDetail";
import { SettingsPage } from "./pages/Settings";
import { TerminalPage } from "./pages/Terminal";
import { AppTerminalPage } from "./pages/AppTerminal";

function Protected({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  useEffect(() => {
    const handler = () => navigate("/login", { replace: true });
    window.addEventListener("launchpad:unauthorized", handler);
    return () => window.removeEventListener("launchpad:unauthorized", handler);
  }, [navigate]);

  if (isPending) {
    return (
      <div className="flex min-h-full items-center justify-center bg-canvas">
        <Spinner label="Checking session…" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <DashboardPage />
          </Protected>
        }
      />
      <Route
        path="/apps/new"
        element={
          <Protected>
            <NewAppPage />
          </Protected>
        }
      />
      <Route
        path="/apps/:id"
        element={
          <Protected>
            <AppDetailPage />
          </Protected>
        }
      />
      <Route
        path="/apps/:id/terminal"
        element={
          <Protected>
            <AppTerminalPage />
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <SettingsPage />
          </Protected>
        }
      />
      <Route
        path="/terminal"
        element={
          <Protected>
            <TerminalPage />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
