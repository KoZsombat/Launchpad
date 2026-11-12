import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, LockKeyhole, Rocket } from "lucide-react";
import { authClient } from "../lib/auth";
import { Button, Field, inputClass } from "../components/ui";

export function LoginPage() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const notice =
    location.state &&
    typeof location.state === "object" &&
    "notice" in location.state &&
    typeof location.state.notice === "string"
      ? location.state.notice
      : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isPending && session) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await authClient.signIn.email({ email, password, rememberMe: true });
      if (result.error) {
        setError(result.error.message ?? "Invalid email or password.");
        return;
      }
      navigate("/", { replace: true });
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-canvas px-4 py-10">
      <div className="app-grid-bg pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-edge bg-panel text-accent shadow-lg">
            <Rocket className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Launchpad</h1>
          <p className="mt-1 text-sm text-muted">Your self-hosted deploy panel</p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-edge bg-panel/90 p-6 shadow-2xl backdrop-blur"
        >
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              className={inputClass}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </Field>

          {notice ? (
            <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}

          <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
            <LockKeyhole className="h-4 w-4" />
            {submitting ? "Signing in…" : "Sign in"}
            {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] text-muted/70">
          Single-user panel. Sign-up is disabled.
        </p>
      </div>
    </div>
  );
}
