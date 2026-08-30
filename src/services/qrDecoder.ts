import jsQR from "jsqr";
import * as jpeg from "jpeg-js";
import { PNG } from "pngjs";

export async function decodeQRCodeFromImage(
  base64: string,
): Promise<string | null> {
  const clean = base64.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(clean, "base64");

  // Detect PNG vs JPEG from magic bytes
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

  let width: number, height: number, data: Buffer;
  if (isPng) {
    const png = PNG.sync.read(buf);
    width = png.width;
    height = png.height;
    data = png.data;
  } else {
    const jpegImg = jpeg.decode(buf, { useTArray: true });
    width = jpegImg.width;
    height = jpegImg.height;
    data = Buffer.from(jpegImg.data);
  }

  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const result = jsQR(rgba, width, height);
  return result?.data ?? null;
}