export const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
export const MAX_BYTES = 10 * 1024 * 1024;

export function validateFile(f: File): string | null {
  if (!ACCEPTED.includes(f.type)) return "Unsupported file type: use PNG, JPEG or WebP.";
  if (f.size > MAX_BYTES) return "File is larger than 10 MB.";
  return null;
}
