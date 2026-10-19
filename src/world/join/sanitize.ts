/**
 * Plain-text cleaning for everything a joining bot sends. The result is stored and shown as plain
 * text only (React escapes it) and is NEVER passed to a model as instructions.
 */

// Control characters (except tab/newline), bidi controls, zero-width and other invisible format characters.
const INVISIBLE_RANGES: readonly [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xffff],
  [0xe0000, 0xe007f],
];

const invisible = (cp: number) => INVISIBLE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
const dropInvisible = (text: string) =>
  Array.from(text)
    .filter((ch) => !invisible(ch.codePointAt(0) ?? 0))
    .join("");

/** NFKC, drop invisible and control characters and angle brackets, collapse spaces, trim, cap length. */
export function cleanText(value: unknown, max: number, opts: { multiline?: boolean } = {}): string {
  if (typeof value !== "string") return "";
  let text = dropInvisible(value.normalize("NFKC")).replace(/[<>]/g, "");
  text = opts.multiline
    ? text
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
    : text.replace(/\s+/g, " ");
  text = text.trim();
  return Array.from(text).slice(0, max).join("").trim();
}

/** Length in code points of the raw input, so oversize fields are refused rather than silently cut. */
export const rawLength = (value: unknown): number =>
  typeof value === "string" ? Array.from(value).length : 0;

/** An https URL with a real host name, or null. No credentials, no IP literals, no localhost. */
export function cleanHomepage(value: unknown, max = 200): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || rawLength(value) > max) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".local") ||
    /^[\d.]+$/.test(host) ||
    host.startsWith("[")
  )
    return null;
  const out = url.toString();
  return out.length <= max ? out : null;
}

/**
 * Key-shaped text: anything that looks like wallet key material. Members must never send it;
 * applications and proposals that carry it are refused and nothing is stored.
 */
export function looksKeyShaped(text: string): boolean {
  if (/\b(0x)?[0-9a-fA-F]{64}\b/.test(text)) return true;
  if (/\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/.test(text)) return true;
  if (/\b[xyzt]prv[1-9A-HJ-NP-Za-km-z]{20,}/.test(text)) return true;
  if (/-----BEGIN [A-Z ]*PRIVATE/.test(text)) return true;
  return false;
}
