import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, checksum]);
}
function makeIcon(size, path) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      let color = [37, 99, 235, 255];
      const insideRoof =
        v >= 0.23 + Math.abs(u - 0.5) * 0.82 &&
        v <= 0.51 &&
        u >= 0.22 &&
        u <= 0.78;
      const insideWall = u >= 0.25 && u <= 0.75 && v >= 0.47 && v <= 0.79;
      if (insideRoof || insideWall) color = [255, 255, 255, 255];
      if (u >= 0.45 && u <= 0.57 && v >= 0.58 && v <= 0.79)
        color = [133, 223, 204, 255];
      if (u >= 0.32 && u <= 0.4 && v >= 0.56 && v <= 0.64)
        color = [74, 128, 242, 255];
      const offset = y * (size * 4 + 1) + x * 4 + 1;
      color.forEach((c, i) => (pixels[offset + i] = c));
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
makeIcon(192, new URL("../public/icon-192.png", import.meta.url));
makeIcon(512, new URL("../public/icon-512.png", import.meta.url));
makeIcon(180, new URL("../public/apple-touch-icon.png", import.meta.url));
