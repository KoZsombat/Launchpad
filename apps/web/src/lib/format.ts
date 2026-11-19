export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "never";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  const units: { unit: Intl.RelativeTimeFormatUnit; size: number }[] = [
    { unit: "minute", size: 60 },
    { unit: "hour", size: 3600 },
    { unit: "day", size: 86_400 },
    { unit: "week", size: 604_800 },
    { unit: "month", size: 2_592_000 },
    { unit: "year", size: 31_536_000 },
  ];
  let chosen = units[0]!;
  for (const unit of units) {
    if (abs >= unit.size) chosen = unit;
  }
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return formatter.format(Math.round(seconds / chosen.size), chosen.unit);
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}
