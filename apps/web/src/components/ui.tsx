import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, Copy, Loader2, X } from "lucide-react";
import type { AppStatus, DeploymentStatus } from "@launchpad/shared";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 shadow-sm",
  secondary: "border border-edge bg-panel-2 text-ink hover:border-muted/40 hover:bg-edge/40",
  ghost: "text-muted hover:bg-panel-2 hover:text-ink",
  danger: "border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export const inputClass =
  "w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted/60 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Panel({
  children,
  className,
  title,
  description,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-edge bg-panel", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-5 py-4">
          <div>
            {title ? <h2 className="text-sm font-semibold text-ink">{title}</h2> : null}
            {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

const appStatusStyles: Record<AppStatus, { badge: string; dot: string; label: string }> = {
  running: {
    badge: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
    label: "Running",
  },
  stopped: {
    badge: "border-muted/30 bg-muted/10 text-muted",
    dot: "bg-muted",
    label: "Stopped",
  },
  failed: {
    badge: "border-danger/30 bg-danger/10 text-danger",
    dot: "bg-danger",
    label: "Failed",
  },
};

export function StatusBadge({ status }: { status: AppStatus }) {
  const style = appStatusStyles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        style.badge,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}

const deploymentStatusStyles: Record<DeploymentStatus, string> = {
  queued: "border-muted/30 bg-muted/10 text-muted",
  building: "border-warning/30 bg-warning/10 text-warning",
  starting: "border-accent/30 bg-accent/10 text-accent",
  healthy: "border-success/30 bg-success/10 text-success",
  failed: "border-danger/30 bg-danger/10 text-danger",
};

export function DeploymentBadge({ status }: { status: DeploymentStatus }) {
  const active = status === "queued" || status === "building" || status === "starting";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize",
        deploymentStatusStyles[status],
      )}
    >
      {active ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {status}
    </span>
  );
}

export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      size="sm"
      variant="secondary"
      className={className}
      onClick={() => {
        if (!navigator.clipboard) return;
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-accent bg-accent" : "border-edge bg-panel-2",
      )}
    >
      <span
        className={cn(
          "absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[20px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close modal"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-edge bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="px-5 py-4 text-sm text-muted">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-t border-edge px-5 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? "Loading…"}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-edge bg-panel/50 px-6 py-16 text-center">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
