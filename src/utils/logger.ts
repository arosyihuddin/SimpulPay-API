import pino from "pino";

const LEVEL_LABEL: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function formatTime(ms: number): string {
  const parts = timeFmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function normalizeLogLevel(
  raw?: string | null,
): pino.LevelWithSilent | undefined {
  switch (raw?.trim().toLowerCase()) {
    case "trace":
      return "trace";
    case "debug":
      return "debug";
    case "info":
      return "info";
    case "warn":
    case "warning":
      return "warn";
    case "error":
      return "error";
    case "fatal":
      return "fatal";
    case "silent":
    case "off":
    case "none":
      return "silent";
    default:
      return undefined;
  }
}

let nodeLevelRaw: string | undefined;
const g: unknown = globalThis;
if (g && typeof g === "object" && "process" in g) {
  const proc: unknown = g.process;
  if (proc && typeof proc === "object" && "env" in proc) {
    const e: unknown = proc.env;
    if (e && typeof e === "object" && "LOG_LEVEL" in e) {
      const v: unknown = e.LOG_LEVEL;
      if (typeof v === "string") nodeLevelRaw = v;
    }
  }
}

export function setLogLevel(raw?: string | null): void {
  const level = normalizeLogLevel(raw);
  if (level) logger.level = level;
}

export const logger = pino({
  level: normalizeLogLevel(nodeLevelRaw) ?? "info",
  browser: {
    write: (o: { level?: number; time?: number; msg?: string }) => {
      const level = LEVEL_LABEL[o.level ?? 30] ?? "INFO";
      console.log(
        `[${level}] ${formatTime(o.time ?? Date.now())} ${o.msg ?? ""}`,
      );
    },
  },
});
