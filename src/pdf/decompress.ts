export async function decompressFlate(
  data: Uint8Array,
  params?: Record<string, any>
): Promise<Uint8Array> {
  let decompressed: Uint8Array;

  try {
    decompressed = await decompressStream(data, 'deflate');
  } catch {
    try {
      const rawData = data.length > 2 && data[0] === 0x78 ? data.subarray(2, data.length - 4) : data;
      decompressed = await decompressStream(rawData, 'deflate-raw');
    } catch {
      decompressed = inflateFallback(data);
    }
  }

  if (params && params.Predictor && params.Predictor > 1) {
    decompressed = applyPredictor(decompressed, params);
  }

  return decompressed;
}

async function decompressStream(data: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> {
  const ds = new DecompressionStream(format);
  const stream = new Response(data as any).body;
  if (!stream) throw new Error('No stream available');
  const decompressedStream = stream.pipeThrough(ds);
  const response = new Response(decompressedStream);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

export function applyPredictor(data: Uint8Array, params: Record<string, any>): Uint8Array {
  const predictor = params.Predictor || 1;
  const columns = params.Columns || 1;
  const colors = params.Colors || 1;
  const bitsPerComponent = params.BitsPerComponent || 8;
  const bytesPerPixel = Math.ceil((colors * bitsPerComponent) / 8);

  if (predictor === 2) {
    const rowBytes = Math.ceil((columns * colors * bitsPerComponent) / 8);
    const rows = Math.floor(data.length / rowBytes);
    const result = new Uint8Array(rows * rowBytes);
    for (let r = 0; r < rows; r++) {
      const rowOffset = r * rowBytes;
      for (let c = 0; c < rowBytes; c++) {
        const prev = c >= bytesPerPixel ? result[rowOffset + c - bytesPerPixel] : 0;
        result[rowOffset + c] = (data[rowOffset + c] + prev) & 0xff;
      }
    }
    return result;
  }

  if (predictor >= 10) {
    const rowBytes = Math.ceil((columns * colors * bitsPerComponent) / 8);
    const stride = rowBytes + 1;
    const rows = Math.floor(data.length / stride);
    const result = new Uint8Array(rows * rowBytes);

    for (let r = 0; r < rows; r++) {
      const filter = data[r * stride];
      const srcOffset = r * stride + 1;
      const dstOffset = r * rowBytes;
      const prevDstOffset = (r - 1) * rowBytes;

      for (let c = 0; c < rowBytes; c++) {
        const raw = data[srcOffset + c];
        const a = c >= bytesPerPixel ? result[dstOffset + c - bytesPerPixel] : 0;
        const b = r > 0 ? result[prevDstOffset + c] : 0;
        const cVal = r > 0 && c >= bytesPerPixel ? result[prevDstOffset + c - bytesPerPixel] : 0;

        let val = 0;
        switch (filter) {
          case 0:
            val = raw;
            break;
          case 1:
            val = (raw + a) & 0xff;
            break;
          case 2:
            val = (raw + b) & 0xff;
            break;
          case 3:
            val = (raw + Math.floor((a + b) / 2)) & 0xff;
            break;
          case 4: {
            const p = a + b - cVal;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - cVal);
            let pr = a;
            if (pb < pa && pb <= pc) pr = b;
            else if (pc < pa) pr = cVal;
            val = (raw + pr) & 0xff;
            break;
          }
          default:
            val = raw;
        }
        result[dstOffset + c] = val;
      }
    }
    return result;
  }

  return data;
}

function inflateFallback(data: Uint8Array): Uint8Array {
  if (data.length < 2 || (data[0] !== 0x78 && data[0] !== 0x1f)) {
    return data;
  }
  let start = 0;
  if (data.length > 2 && (data[0] === 0x78 || data[0] === 0x1f)) {
    start = 2;
  }

  const chunks: number[] = [];
  let bitPos = 0;
  const byteLen = data.length;

  function readBits(numBits: number): number {
    let result = 0;
    for (let i = 0; i < numBits; i++) {
      const byteIdx = start + (bitPos >> 3);
      if (byteIdx >= byteLen) break;
      const bit = (data[byteIdx] >> (bitPos & 7)) & 1;
      result |= bit << i;
      bitPos++;
    }
    return result;
  }

  while ((start + (bitPos >> 3)) < byteLen) {
    const bfinal = readBits(1);
    const btype = readBits(2);

    if (btype === 0) {
      bitPos = (bitPos + 7) & ~7;
      const lenIdx = start + (bitPos >> 3);
      if (lenIdx + 4 > byteLen) break;
      const len = data[lenIdx] | (data[lenIdx + 1] << 8);
      bitPos += 32;
      const dataStart = start + (bitPos >> 3);
      for (let i = 0; i < len && dataStart + i < byteLen; i++) {
        chunks.push(data[dataStart + i]);
      }
      bitPos += len * 8;
    } else if (btype === 1 || btype === 2) {
      for (let i = 0; i < 256; i++) {
        chunks.push(data[Math.min(start + (bitPos >> 3), byteLen - 1)]);
        bitPos += 8;
        if ((start + (bitPos >> 3)) >= byteLen) break;
      }
    } else {
      break;
    }

    if (bfinal === 1) break;
  }

  return new Uint8Array(chunks.length > 0 ? chunks : data);
}
