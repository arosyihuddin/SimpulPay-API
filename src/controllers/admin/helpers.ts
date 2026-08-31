import type { Context } from "hono";
import type { AppEnv } from "../../types";

export function bad(message: string, status = 400): never {
  const err: any = new Error(message);
  err.status = status;
  throw err;
}

export function paramId(c: Context<AppEnv>): string {
  const id = c.req.param("id");
  if (!id) bad("id wajib ada", 400);
  return id;
}
