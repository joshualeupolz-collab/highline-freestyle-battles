import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Throws an API error. The response body is always `{ error: code, message?, details? }`;
 * `code` is a stable machine-readable string the web app can translate.
 */
export function apiError(
  status: ContentfulStatusCode,
  code: string,
  message?: string,
  details?: unknown,
): never {
  const body = JSON.stringify({ error: code, message, details });
  throw new HTTPException(status, {
    res: new Response(body, { status, headers: { 'Content-Type': 'application/json' } }),
  });
}
