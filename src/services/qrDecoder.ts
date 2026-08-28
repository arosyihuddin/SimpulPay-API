// QR decode dari image (base64) — jimp + jsqr
import { Jimp } from 'jimp';
import jsQR from 'jsqr';

export async function decodeQRCodeFromImage(base64: string): Promise<string | null> {
  const clean = base64.replace(/^data:image\/\w+;base64,/, '');
  const image = await Jimp.read(Buffer.from(clean, 'base64'));
  const { width, height, data } = image.bitmap;
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const result = jsQR(rgba, width, height);
  return result?.data ?? null;
}
