import { mkdir, rename, unlink, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NUTRITION_PRODUCTS_DIR } from "../constants.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("nutrition-product-photos");

export function mimeToExt(mime: string): string {
  const normalized = mime.trim().toLowerCase();
  switch (normalized) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export interface StoredPhoto {
  /** Path relative to project root — safe to persist in DB. */
  relativePath: string;
  absolutePath: string;
  mime: string;
}

/** Atomic write-then-rename so a crash mid-write never leaves a half-written file at the target path. */
export async function savePackagePhoto(
  userId: number,
  productId: number,
  buffer: Buffer,
  mime: string,
): Promise<StoredPhoto> {
  const ext = mimeToExt(mime);
  const userDir = join(NUTRITION_PRODUCTS_DIR, String(userId));
  await mkdir(userDir, { recursive: true });

  const filename = `${productId}_${Date.now()}.${ext}`;
  const absolutePath = join(userDir, filename);
  const tempPath = `${absolutePath}.tmp`;

  await writeFile(tempPath, buffer);
  await rename(tempPath, absolutePath);

  const relativePath = join(NUTRITION_PRODUCTS_DIR, String(userId), filename);
  return { relativePath, absolutePath, mime };
}

/**
 * ENOENT is swallowed — a missing file is treated as already removed (idempotent).
 * Other errors are logged but not re-thrown, because row deletion must succeed even if file cleanup fails.
 */
export async function removePackagePhoto(relativePath: string | null): Promise<void> {
  if (!relativePath) return;
  try {
    await unlink(relativePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return;
    log.warn(`Failed to remove product photo at ${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function readPackagePhoto(relativePath: string): Promise<Buffer> {
  return readFile(relativePath);
}
