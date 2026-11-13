import { Globe2, Plus, Trash2 } from "lucide-react";
import { Button, inputClass } from "./ui";

export function SubdomainsEditor({
  values,
  baseDomain,
  onChange,
  disabled,
}: {
  values: string[];
  baseDomain: string;
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, value: string) => {
    onChange(values.map((entry, entryIndex) => (entryIndex === index ? value : entry)));
  };

  return (
    <div className="space-y-2">
      {values.length === 0 ? (
        <p className="rounded-lg border border-dashed border-edge px-3 py-3 text-center text-xs text-muted">
          No subdomains. A published service needs at least one.
        </p>
      ) : null}
      {values.map((value, index) => (
        <div key={index} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Globe2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              className={`${inputClass} pl-8 font-mono`}
              value={value}
              onChange={(event) => update(index, event.target.value.toLowerCase())}
              placeholder="app"
              spellCheck={false}
              disabled={disabled}
            />
          </div>
          <span className="hidden shrink-0 text-xs text-muted sm:block">.{baseDomain}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Remove subdomain"
            disabled={disabled}
            onClick={() => onChange(values.filter((_, entryIndex) => entryIndex !== index))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...values, ""])}
      >
        <Plus className="h-3.5 w-3.5" />
        Add subdomain
      </Button>
    </div>
  );
}
