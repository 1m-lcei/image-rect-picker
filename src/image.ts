import type { Size } from "./geometry";

export const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
];
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;

export interface LoadedImage extends Size {
  url: string;
  name: string;
}

export function validateFile(file: Pick<File, "type" | "size">): void {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error("PNG、JPEG、WebP、GIF、BMPの画像を選択してください。");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("画像ファイルは256 MiB以下にしてください。");
  }
}

export function validateSize(size: Size): void {
  if (
    !Number.isSafeInteger(size.width) ||
    !Number.isSafeInteger(size.height) ||
    size.width < 1 ||
    size.height < 1
  ) {
    throw new Error("画像の寸法を読み取れませんでした。");
  }
  if (size.width * size.height > MAX_IMAGE_PIXELS) {
    throw new Error("画像サイズは50メガピクセル以下にしてください。");
  }
}

export function validateSignature(type: string, bytes: Uint8Array): void {
  const startsWith = (signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  const text = String.fromCharCode(...bytes);
  const matches: Record<string, boolean> = {
    "image/png": startsWith([137, 80, 78, 71, 13, 10, 26, 10]),
    "image/jpeg": startsWith([255, 216, 255]),
    "image/gif": text.startsWith("GIF87a") || text.startsWith("GIF89a"),
    "image/webp": text.startsWith("RIFF") && text.slice(8, 12) === "WEBP",
    "image/bmp": text.startsWith("BM"),
  };
  if (!matches[type])
    throw new Error(
      "画像の内容がファイル形式と一致しません。SVGは利用できません。",
    );
}

// Read dimensions without decoding pixels or buffering the entire file.
export async function readImageSize(file: File): Promise<Size> {
  validateFile(file);
  let buffer = new ArrayBuffer(0);
  let start = 0;
  const invalid = () => new Error("画像の寸法を読み取れませんでした。");
  const read = async (offset: number, length: number): Promise<DataView> => {
    if (offset < 0 || offset + length > file.size) throw invalid();
    if (offset < start || offset + length > start + buffer.byteLength) {
      start = offset;
      buffer = await file.slice(offset, offset + 65536).arrayBuffer();
    }
    return new DataView(buffer, offset - start, length);
  };
  const header = await read(0, 12);
  validateSignature(
    file.type,
    new Uint8Array(header.buffer, header.byteOffset, header.byteLength),
  );
  switch (file.type) {
    case "image/png": {
      const data = await read(12, 12);
      if (header.getUint32(8) !== 13 || data.getUint32(0) !== 0x49484452)
        throw invalid();
      return { width: data.getUint32(4), height: data.getUint32(8) };
    }
    case "image/gif":
      return {
        width: header.getUint16(6, true),
        height: header.getUint16(8, true),
      };
    case "image/bmp": {
      const data = await read(14, 12);
      const dibSize = data.getUint32(0, true);
      if (dibSize === 12)
        return {
          width: data.getUint16(4, true),
          height: data.getUint16(6, true),
        };
      if (![16, 40, 52, 56, 64, 108, 124].includes(dibSize)) throw invalid();
      return {
        width: data.getInt32(4, true),
        height: Math.abs(data.getInt32(8, true)),
      };
    }
    case "image/webp": {
      const chunk = await read(12, 8);
      const length = chunk.getUint32(4, true);
      if (
        20 + length > file.size ||
        20 + length > header.getUint32(4, true) + 8
      )
        throw invalid();
      switch (chunk.getUint32(0)) {
        case 0x56503858: {
          // VP8X: extended canvas, including animated WebP.
          if (length !== 10) throw invalid();
          const data = await read(20, 10);
          return {
            width: 1 + data.getUint16(4, true) + (data.getUint8(6) << 16),
            height: 1 + data.getUint16(7, true) + (data.getUint8(9) << 16),
          };
        }
        case 0x56503820: {
          // VP8: lossy key frame.
          if (length < 10) throw invalid();
          const data = await read(20, 10);
          if (
            data.getUint8(0) & 1 ||
            data.getUint8(3) !== 0x9d ||
            data.getUint16(4) !== 0x012a
          )
            throw invalid();
          return {
            width: data.getUint16(6, true) & 0x3fff,
            height: data.getUint16(8, true) & 0x3fff,
          };
        }
        case 0x5650384c: {
          // VP8L: lossless dimensions packed into 28 bits.
          if (length < 5) throw invalid();
          const data = await read(20, 5);
          if (data.getUint8(0) !== 0x2f) throw invalid();
          const bits = data.getUint32(1, true);
          if (bits >>> 29) throw invalid();
          return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >>> 14) & 0x3fff) + 1,
          };
        }
      }
      throw invalid();
    }
    case "image/jpeg": {
      let offset = 2;
      while (offset < file.size) {
        if ((await read(offset++, 1)).getUint8(0) !== 0xff) throw invalid();
        let marker = (await read(offset++, 1)).getUint8(0);
        while (marker === 0xff) marker = (await read(offset++, 1)).getUint8(0);
        if (marker === 0xd9 || marker === 0xda || marker === 0) throw invalid();
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const length = (await read(offset, 2)).getUint16(0);
        if (length < 2 || offset + length > file.size) throw invalid();
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          ![0xc4, 0xc8, 0xcc].includes(marker)
        ) {
          if (length < 8) throw invalid();
          const frame = await read(offset + 2, 5);
          return { width: frame.getUint16(3), height: frame.getUint16(1) };
        }
        offset += length;
      }
    }
  }
  throw invalid();
}

export async function loadImage(file: File): Promise<LoadedImage> {
  // EXIF rotation can swap axes, but leaves the pixel count unchanged.
  validateSize(await readImageSize(file));
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error(
        "画像を読み込めませんでした。ファイルが破損していないか確認してください。",
      );
    }
    const size = { width: image.naturalWidth, height: image.naturalHeight };
    validateSize(size);
    return { ...size, url, name: file.name };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
