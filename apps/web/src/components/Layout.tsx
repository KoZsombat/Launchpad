import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutGrid,
  LogOut,
  Moon,
  Plus,
  Rocket,
  Settings2,
  SquareTerminal,
  Sun,
} from "lucide-react";
import { authClient } from "../lib/auth";
import { cn } from "./ui";

const navItems = [
  { to: "/", label: "Applications", icon: LayoutGrid, end: true },
  { to: "/apps/new", label: "New app", icon: Plus, end: false },
  { to: "/settings", label: "Settings", icon: Settings2, end: false },
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("launchpad-theme");
    return stored ? stored === "dark" : true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("launchpad-theme", dark ? "dark" : "light");
  }, [dark]);

  return { dark, setDark };
}

export function Layout({ children }: { children: ReactNode }) {
  const { dark, setDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const cliActive = location.pathname.startsWith("/terminal");

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        navigate(location.pathname.startsWith("/terminal") ? "/" : "/terminal");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [location.pathname, navigate]);

  const signOut = () => {
    void authClient.signOut().then(() => navigate("/login"));
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
      <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-edge bg-panel/60 lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Rocket className="h-4.5 w-4.5" style={{ height: 18, width: 18 }} />
          </span>
          <div>
            <div className="text-sm font-semibold tracking-tight">Launchpad</div>
            <div className="text-[11px] text-muted">Deploy panel</div>
          </div>
        </div>

        <div className="px-3">
          <div className="flex rounded-lg border border-edge bg-panel-2 p-1 text-xs font-medium">
            <Link
              to="/"
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition-colors",
                !cliActive ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              GUI
            </Link>
            <Link
              to="/terminal"
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition-colors",
                cliActive ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              <SquareTerminal className="h-3.5 w-3.5" />
              CLI
            </Link>
          </div>
          <p className="mt-2 px-1 text-[10px] text-muted/70">Ctrl + ` toggles GUI / CLI</p>
        </div>

        <nav className="mt-5 flex-1 space-y-1 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:bg-panel-2 hover:text-ink",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-1 border-t border-edge p-3">
          <button
            onClick={() => setDark(!dark)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-edge bg-panel/95 backdrop-blur lg:hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2.5">
            <Link to="/" className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Rocket className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold">Launchpad</span>
            </Link>
            <div className="flex items-center gap-1">
              <Link
                to="/terminal"
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs",
                  cliActive ? "bg-accent/10 text-accent" : "text-muted",
                )}
              >
                CLI
              </Link>
              <button
                onClick={() => setDark(!dark)}
                className="rounded-md p-2 text-muted hover:bg-panel-2 hover:text-ink"
                aria-label="Toggle theme"
              >
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                onClick={signOut}
                className="rounded-md p-2 text-muted hover:bg-panel-2 hover:text-ink"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </header>

          <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs",
                    isActive ? "bg-accent/10 text-accent" : "text-muted",
                  )
                }
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <header className="hidden shrink-0 items-center justify-end gap-2 border-b border-edge bg-panel/70 px-6 py-2.5 backdrop-blur lg:flex">
          <span className="mr-auto text-[11px] uppercase tracking-widest text-muted">
            {cliActive ? "Web SSH terminal" : "Deploy dashboard"}
          </span>
          <button
            onClick={() => setDark(!dark)}
            className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-ink"
            aria-label="Toggle theme"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>

        <main
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain",
            cliActive ? "flex flex-col p-2 sm:p-3 lg:p-4" : "p-3 sm:p-4 lg:p-8",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
