import { useEffect, useState } from "react";

import { AdminWorkspace } from "./components/AdminWorkspace";
import { LoginScreen } from "./components/LoginScreen";
import { MapWorkspace } from "./components/MapWorkspace";
import { apiRequest } from "./lib/api";

export type UserRole = "admin" | "reviewer" | "client";

export type Session = {
  token: string;
  user: {
    id: number;
    email: string;
    name: string;
    role: UserRole;
  };
};

type WorkspaceView = "review" | "admin";
type SessionPayload = {
  user: Session["user"];
};

const STORAGE_KEY = "qaviewer.session";

function loadSession(): Session | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Session;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function persistSession(session: Session) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [view, setView] = useState<WorkspaceView>("review");

  useEffect(() => {
    if (session?.user.role !== "admin" && view === "admin") {
      setView("review");
    }
  }, [session, view]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const sessionToken = session.token;
    let alive = true;

    async function refreshSession() {
      try {
        const payload = await apiRequest<SessionPayload>("/auth/me", {
          token: sessionToken,
        });

        if (!alive) {
          return;
        }

        setSession((current) => {
          if (!current || current.token !== sessionToken) {
            return current;
          }

          const unchanged =
            current.user.id === payload.user.id &&
            current.user.email === payload.user.email &&
            current.user.name === payload.user.name &&
            current.user.role === payload.user.role;

          if (unchanged) {
            return current;
          }

          const nextSession = { ...current, user: payload.user };
          persistSession(nextSession);
          return nextSession;
        });
      } catch (error) {
        if (error instanceof Error && error.message === "Session expired. Please sign in again.") {
          return;
        }
        console.error("Failed to refresh session", error);
      }
    }

    void refreshSession();

    function handleFocus() {
      void refreshSession();
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", handleFocus);
    };
  }, [session?.token]);

  function updateSessionUser(user: Session["user"]) {
    setSession((current) => {
      if (!current) {
        return current;
      }

      const nextSession = { ...current, user };
      persistSession(nextSession);
      return nextSession;
    });
  }

  async function handleLogin(credentials: { email: string; password: string }) {
    const payload = await apiRequest<Session>("/auth/login", {
      method: "POST",
      body: credentials,
    });
    setSession(payload);
    persistSession(payload);
  }

  function handleLogout() {
    setView("review");
    setSession(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (session.user.role === "admin" && view === "admin") {
    return (
      <AdminWorkspace
        session={session}
        onLogout={handleLogout}
        onOpenReview={() => setView("review")}
        onSessionUpdate={updateSessionUser}
      />
    );
  }

  return (
    <MapWorkspace
      session={session}
      onLogout={handleLogout}
      onOpenAdmin={session.user.role === "admin" ? () => setView("admin") : undefined}
    />
  );
}
