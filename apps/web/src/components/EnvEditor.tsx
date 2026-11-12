import { Plus, Trash2 } from "lucide-react";
import { Button, inputClass } from "./ui";

export interface EnvRowState {
  id: string;
  key: string;
  value: string;
  secret: boolean;
  hasValue?: boolean;
}

export function newEnvRow(): EnvRowState {
  return { id: crypto.randomUUID(), key: "", value: "", secret: false };
}

export function EnvEditor({
  rows,
  onChange,
}: {
  rows: EnvRowState[];
  onChange: (rows: EnvRowState[]) => void;
}) {
  const update = (id: string, patch: Partial<EnvRowState>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-edge px-3 py-4 text-center text-xs text-muted">
          No environment variables yet.
        </p>
      ) : null}
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className={`${inputClass} font-mono sm:w-52`}
            placeholder="KEY"
            value={row.key}
            onChange={(event) => update(row.id, { key: event.target.value })}
            spellCheck={false}
          />
          <input
            className={`${inputClass} flex-1 font-mono`}
            placeholder={row.secret && row.hasValue ? "•••••••• (unchanged)" : "value"}
            type={row.secret ? "password" : "text"}
            value={row.value}
            onChange={(event) => update(row.id, { value: event.target.value })}
            spellCheck={false}
          />
          <label className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-edge bg-panel px-3 py-2 text-xs text-muted sm:border-0 sm:bg-transparent sm:px-0">
            <input
              type="checkbox"
              checked={row.secret}
              onChange={(event) => update(row.id, { secret: event.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Secret
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Remove variable"
            onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" onClick={() => onChange([...rows, newEnvRow()])}>
        <Plus className="h-3.5 w-3.5" />
        Add variable
      </Button>
    </div>
  );
}

export interface VolumeRowState {
  id: string;
  containerPath: string;
  volumeName: string;
}

export function newVolumeRow(): VolumeRowState {
  return { id: crypto.randomUUID(), containerPath: "", volumeName: "" };
}

export function VolumesEditor({
  rows,
  onChange,
}: {
  rows: VolumeRowState[];
  onChange: (rows: VolumeRowState[]) => void;
}) {
  const update = (id: string, patch: Partial<VolumeRowState>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-edge px-3 py-4 text-center text-xs text-muted">
          No persistent volumes.
        </p>
      ) : null}
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className={`${inputClass} font-mono`}
            placeholder="container path, e.g. /data"
            value={row.containerPath}
            onChange={(event) => update(row.id, { containerPath: event.target.value })}
            spellCheck={false}
          />
          <span className="hidden text-muted sm:block">→</span>
          <input
            className={`${inputClass} font-mono`}
            placeholder="named volume, e.g. myapp-data"
            value={row.volumeName}
            onChange={(event) => update(row.id, { volumeName: event.target.value })}
            spellCheck={false}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Remove volume"
            onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" onClick={() => onChange([...rows, newVolumeRow()])}>
        <Plus className="h-3.5 w-3.5" />
        Add volume
      </Button>
    </div>
  );
}
