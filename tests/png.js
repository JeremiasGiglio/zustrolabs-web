// Lee el primer píxel de un PNG (sin dependencias) para chequear colores en los tests.
import { inflateSync } from 'node:zlib';
export const PNG = {
  firstPixel(buf) {
    let off = 8, idat = [], w = 0, ct = 6;
    while (off < buf.length) {
      const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
      if (type === 'IHDR') { w = data.readUInt32BE(0); ct = data[9]; }
      if (type === 'IDAT') idat.push(data);
      off += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const bpp = ct === 6 ? 4 : 3; // primera fila: filtro en raw[0]; el primer píxel no depende del filtro "Sub"/"None"
    return { r: raw[1], g: raw[2], b: raw[3], w, bpp };
  },
};
