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

export const logger = pino({
  browser: {
    write: (o: { level?: number; time?: number; msg?: string }) => {
      const level = LEVEL_LABEL[o.level ?? 30] ?? "INFO";
      console.log(
        `[${level}] ${formatTime(o.time ?? Date.now())} ${o.msg ?? ""}`,
      );
    },
  },
});
