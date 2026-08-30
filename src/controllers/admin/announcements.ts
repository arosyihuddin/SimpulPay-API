import {
  createAnnouncement,
  getAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, paramId } from "./helpers";

const TYPES = ["info", "warning", "important"];

export async function createAnnouncementCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const title = (body?.title || "").trim();
  const message = (body?.message || "").trim();
  if (title.length < 2) bad("Judul pengumuman minimal 2 karakter");
  if (message.length < 2) bad("Isi pengumuman minimal 2 karakter");
  if (body?.type && !TYPES.includes(body.type)) bad("Type harus info/warning/important");
  await createAnnouncement(DB, {
    title,
    message,
    type: body?.type ?? "info",
    active: body?.active !== false,
  });
  return c.json({ success: true });
}

export async function updateAnnouncementCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = parseInt(paramId(c), 10);
  if (isNaN(id)) bad("ID pengumuman tidak valid");
  if (!(await getAnnouncement(DB, id))) bad("Pengumuman tidak ditemukan", 404);
  const body = await c.req.json();
  const patch: Record<string, unknown> = {};
  if (body?.title !== undefined) {
    const title = String(body.title).trim();
    if (title.length < 2) bad("Judul pengumuman minimal 2 karakter");
    patch.title = title;
  }
  if (body?.message !== undefined) {
    const message = String(body.message).trim();
    if (message.length < 2) bad("Isi pengumuman minimal 2 karakter");
    patch.message = message;
  }
  if (body?.type !== undefined) {
    if (!TYPES.includes(body.type)) bad("Type harus info/warning/important");
    patch.type = body.type;
  }
  if (body?.active !== undefined) patch.active = body.active === true || body.active === "true";
  await updateAnnouncement(DB, id, patch);
  return c.json({ success: true });
}

export async function deleteAnnouncementCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = parseInt(paramId(c), 10);
  if (isNaN(id)) bad("ID pengumuman tidak valid");
  if (!(await getAnnouncement(DB, id))) bad("Pengumuman tidak ditemukan", 404);
  await deleteAnnouncement(DB, id);
  return c.json({ success: true });
}
