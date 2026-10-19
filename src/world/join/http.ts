/** Small HTTP helpers shared by the public join endpoints. */
export const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });

export const clientIp = (request: Request) =>
  (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    request.headers.get("x-real-ip") ||
    "anon"
  )
    .trim()
    .slice(0, 64);

/** Public origin, honouring the proxy's forwarded host/proto. */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = (request.headers.get("x-forwarded-host") || url.host).split(",")[0].trim();
  const proto = (request.headers.get("x-forwarded-proto") || url.protocol.replace(":", ""))
    .split(",")[0]
    .trim();
  return /^[A-Za-z0-9.:-]{1,200}$/.test(host) && (proto === "https" || proto === "http")
    ? `${proto}://${host}`
    : url.origin;
}

export type BodyRead = { ok: true; body: unknown } | { ok: false; response: Response };

/** Read a JSON body of at most `max` bytes. Checks content-length AND the real byte count. */
export async function readJsonBody(request: Request, max: number): Promise<BodyRead> {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > max)
    return { ok: false, response: json(413, { error: `Body too large (max ${max} bytes).` }) };
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json"))
    return { ok: false, response: json(415, { error: "Send application/json." }) };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > max)
    return { ok: false, response: json(413, { error: `Body too large (max ${max} bytes).` }) };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: json(400, { error: "Body is not valid JSON." }) };
  }
}

/** Map a thrown ColonyError (has .status) to JSON; anything else is a plain 500 with no detail. */
export function errorResponse(err: unknown): Response {
  const status = (err as { status?: number })?.status;
  if (typeof status === "number" && status >= 400 && status < 500)
    return json(
      status,
      { error: (err as Error).message },
      status === 429 ? { "retry-after": "3600" } : {},
    );
  console.error("[colony-join]", (err as Error)?.message ?? err);
  return json(500, { error: "Something went wrong." });
}
