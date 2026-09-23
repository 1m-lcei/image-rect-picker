import type { Size } from "./geometry";

export const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
];
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
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
    throw new Error("画像ファイルは20 MiB以下にしてください。");
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

export async function loadImage(file: File): Promise<LoadedImage> {
  validateFile(file);
  validateSignature(
    file.type,
    new Uint8Array(await file.slice(0, 12).arrayBuffer()),
  );
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
