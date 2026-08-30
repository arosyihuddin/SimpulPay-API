export const ok = (data: object) => ({ success: true, ...data });

export function fail(code: number, message: string, extra: object = {}): never {
  const err: any = new Error(message);
  err.status = code;
  err.extra = extra;
  throw err;
}
