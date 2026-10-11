import type { Context } from 'hono';
import type { z } from 'zod';
import { apiError } from './errors';

/**
 * Reads and validates a JSON request body. Only `application/json` is accepted, which (with
 * SameSite cookies) also prevents cross-site form submissions.
 */
export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) {
    apiError(415, 'unsupported_media_type', 'Expected a JSON body');
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    apiError(400, 'invalid_json');
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    apiError(
      400,
      'validation_failed',
      undefined,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
