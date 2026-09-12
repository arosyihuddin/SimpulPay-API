/** Offset WIB dalam ms. */
export const WIB_OFFSET_MS = 7 * 3600_000;

/** Awal hari ini zona WIB sebagai epoch ms. Worker jalan UTC — tanpa ini reset jatuh jam 07:00 WIB. */
export function startOfTodayWib(now = Date.now()): number {
  const shifted = new Date(now + WIB_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted.getTime() - WIB_OFFSET_MS;
}

/** Awal bulan berjalan zona WIB sebagai epoch ms. */
export function startOfMonthWib(now = Date.now()): number {
  const shifted = new Date(now + WIB_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - WIB_OFFSET_MS;
}
