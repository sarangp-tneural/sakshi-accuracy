import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { api, getToken, setToken } from "./api";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import ProjectPage from "./pages/ProjectPage";
import Count from "./pages/Count";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ui/Toast";

function Guard({ children }: { children: React.ReactElement }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const [email, setEmail] = useState("");
  const authed = !!getToken();
  useEffect(() => { if (authed) api.me().then((m) => setEmail(m.email)).catch(() => {}); }, [authed]);
  return (
    <ToastProvider>
      <ErrorBoundary>
        {getToken() && (
          <header className="topbar">
            <Link to="/">Sakshi Verify</Link>
            <div className="profile">
              {email && <span className="profile-email" title={email}>{email}</span>}
              <button className="btn sm" onClick={() => { setToken(null); location.href = "/login"; }}>Log out</button>
            </div>
          </header>
        )}
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Guard><Projects /></Guard>} />
          <Route path="/projects/:pid" element={<Guard><ProjectPage tab="videos" /></Guard>} />
          <Route path="/projects/:pid/report" element={<Guard><ProjectPage tab="report" /></Guard>} />
          <Route path="/projects/:pid/settings" element={<Guard><ProjectPage tab="settings" /></Guard>} />
          <Route path="/videos/:id" element={<Guard><Count /></Guard>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </ErrorBoundary>
    </ToastProvider>
  );
}
