// Response + error helpers seragam — dipakai semua route
export const ok = (data: object) => ({ success: true, ...data });

// NB: must be function declaration (not arrow) agar TS control-flow narrowing jalan
export function fail(code: number, message: string, extra: object = {}): never {
  const err: any = new Error(message);
  err.status = code;
  err.extra = extra;
  throw err;
}
