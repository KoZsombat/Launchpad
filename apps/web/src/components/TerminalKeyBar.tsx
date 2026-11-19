import type { PointerEvent } from "react";
import { cn } from "./ui";

interface TerminalKeyBarProps {
  onSend: (data: string) => void;
  ctrlArmed: boolean;
  onToggleCtrl: () => void;
}

const controlKeys = [
  { label: "^C", data: "\x03" },
  { label: "^D", data: "\x04" },
  { label: "^Z", data: "\x1a" },
  { label: "^L", data: "\x0c" },
  { label: "^O", data: "\x0f" },
  { label: "^X", data: "\x18" },
  { label: "^W", data: "\x17" },
  { label: "^K", data: "\x0b" },
  { label: "^U", data: "\x15" },
  { label: "^R", data: "\x12" },
];

const navigationKeys = [
  { label: "Esc", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "←", data: "\x1b[D" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "→", data: "\x1b[C" },
  { label: "Home", data: "\x1b[H" },
  { label: "End", data: "\x1b[F" },
  { label: "PgUp", data: "\x1b[5~" },
  { label: "PgDn", data: "\x1b[6~" },
  { label: "Ins", data: "\x1b[2~" },
  { label: "Del", data: "\x1b[3~" },
];

const keyClass =
  "shrink-0 rounded-md border border-edge bg-panel-2 px-2.5 py-1.5 font-mono text-xs text-ink active:bg-accent/15 active:text-accent";

/** Touch-friendly keys that mobile keyboards cannot produce (Esc, Ctrl, arrows). */
export function TerminalKeyBar({ onSend, ctrlArmed, onToggleCtrl }: TerminalKeyBarProps) {
  const press = (event: PointerEvent<HTMLButtonElement>, data: string) => {
    // Keep the xterm textarea focused so the on-screen keyboard stays open.
    event.preventDefault();
    onSend(data);
  };

  const paste = async (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      const text = await navigator.clipboard.readText();
      if (text) onSend(text);
    } catch {
      const text = window.prompt("Paste into the terminal");
      if (text) onSend(text);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Terminal keys"
      className="flex items-center gap-1 overflow-x-auto border-t border-edge bg-panel px-2 py-2 lg:hidden"
    >
      <button
        type="button"
        aria-pressed={ctrlArmed}
        onPointerDown={(event) => {
          event.preventDefault();
          onToggleCtrl();
        }}
        className={cn(keyClass, ctrlArmed && "border-accent/50 bg-accent/15 text-accent")}
      >
        Ctrl
      </button>
      {controlKeys.map((key) => (
        <button
          key={key.label}
          type="button"
          onPointerDown={(event) => press(event, key.data)}
          className={keyClass}
        >
          {key.label}
        </button>
      ))}
      <span className="mx-0.5 h-5 w-px shrink-0 bg-edge" />
      {navigationKeys.map((key) => (
        <button
          key={key.label}
          type="button"
          onPointerDown={(event) => press(event, key.data)}
          className={keyClass}
        >
          {key.label}
        </button>
      ))}
      <button type="button" onPointerDown={(event) => void paste(event)} className={keyClass}>
        Paste
      </button>
    </div>
  );
}
