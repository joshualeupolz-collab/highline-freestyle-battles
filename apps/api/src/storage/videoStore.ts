/**
 * Replaceable storage layer for video files (CLAUDE.md, architecture rule 4).
 *
 * Routes only talk to `VideoStore`; `video_files.backend` + `locator` say where a file lives.
 * Today there is one backend, Cloudflare R2, in two modes:
 *
 * - **direct** (production): the phone uploads to R2 with a pre-signed URL and plays videos from
 *   a pre-signed URL. The bytes never pass through the Worker, so they cost no Worker CPU time.
 *   Needs an R2 access key (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`).
 * - **through the Worker** (local development, tests, or before the access key is set up): the
 *   bytes go through `/api/videos/:id/upload` and `/api/videos/:id/file` into the R2 binding.
 *   Workers Free accepts request bodies up to 100 MB, hence MAX_VIDEO_BYTES.
 *
 * Big videos are sent in parts (R2 multipart upload). The Worker opens, completes and aborts the
 * upload through the R2 binding (an upload opened there can be continued through the S3 API); the
 * parts themselves go to signed URLs or through the Worker, like a single upload.
 *
 * Later backends (Telegram archive, hard drive) implement the same interface.
 */
import type { UploadedPart, UploadTarget } from '@hfb/shared';
import { AwsClient } from 'aws4fetch';
import type { Env } from '../env';

export interface VideoStore {
  readonly backend: 'r2';
  /** Where the phone sends the bytes of `key`. */
  uploadTarget(key: string, contentType: string, videoId: string): Promise<UploadTarget>;
  /** Opens an upload in parts; returns its upload id. */
  createMultipart(key: string, contentType: string): Promise<string>;
  /** Where the phone sends part `partNumber` (1-based) of the upload in parts. */
  partTarget(
    key: string,
    uploadId: string,
    partNumber: number,
    videoId: string,
  ): Promise<UploadTarget>;
  /** Puts the parts together into the file `key`. Throws if a part is missing or wrong. */
  completeMultipart(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>;
  /** Drops an unfinished upload in parts and its parts (unknown ids are ignored). */
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** Size of a stored file in bytes, or null if it does not exist. */
  size(key: string): Promise<number | null>;
  /** Answer to a request for the file: a redirect to a signed URL, or the bytes themselves. */
  serve(key: string, request: Request): Promise<Response>;
  /** Deletes files; several keys in one call (R2 accepts up to 1,000). */
  delete(keys: string | string[]): Promise<void>;
}

/** How long signed URLs stay valid. Uploads of big files on slow connections need a while. */
const UPLOAD_URL_SECONDS = 60 * 60;
const DOWNLOAD_URL_SECONDS = 6 * 60 * 60;

export function videoStore(env: Env): VideoStore {
  const bucket = env.VIDEOS;
  const common = {
    backend: 'r2' as const,
    async size(key: string) {
      return (await bucket.head(key))?.size ?? null;
    },
    async delete(keys: string | string[]) {
      await bucket.delete(keys);
    },
    async createMultipart(key: string, contentType: string) {
      return (await bucket.createMultipartUpload(key, { httpMetadata: { contentType } })).uploadId;
    },
    async completeMultipart(key: string, uploadId: string, parts: UploadedPart[]) {
      await bucket.resumeMultipartUpload(key, uploadId).complete(
        [...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          // The S3 API sends the ETag in quotes, the binding wants it without.
          .map((p) => ({ partNumber: p.partNumber, etag: p.etag.replace(/^(W\/)?"|"$/g, '') })),
      );
    },
    async abortMultipart(key: string, uploadId: string) {
      try {
        await bucket.resumeMultipartUpload(key, uploadId).abort();
      } catch {
        // Already completed, aborted, or expired.
      }
    },
  };

  if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID) {
    const client = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    });
    const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}`;
    const presign = async (
      method: 'GET' | 'PUT',
      key: string,
      seconds: number,
      query: Record<string, string> = {},
    ) => {
      const url = new URL(`${endpoint}/${key}`);
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
      url.searchParams.set('X-Amz-Expires', String(seconds));
      const signed = await client.sign(new Request(url, { method }), { aws: { signQuery: true } });
      return signed.url;
    };
    return {
      ...common,
      async uploadTarget(key, contentType) {
        return {
          url: await presign('PUT', key, UPLOAD_URL_SECONDS),
          method: 'PUT',
          headers: { 'Content-Type': contentType },
        };
      },
      async partTarget(key, uploadId, partNumber) {
        const query = { partNumber: String(partNumber), uploadId };
        return {
          url: await presign('PUT', key, UPLOAD_URL_SECONDS, query),
          method: 'PUT',
          headers: {},
        };
      },
      async serve(key) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: await presign('GET', key, DOWNLOAD_URL_SECONDS),
            // The browser may reuse the redirect while the signed URL is valid.
            'Cache-Control': `private, max-age=${DOWNLOAD_URL_SECONDS - 600}`,
          },
        });
      },
    };
  }

  return {
    ...common,
    async uploadTarget(_key, contentType, videoId) {
      return {
        url: `/api/videos/${videoId}/upload`,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
      };
    },
    async partTarget(_key, uploadId, partNumber, videoId) {
      return {
        url: `/api/videos/${videoId}/parts/${partNumber}`,
        method: 'PUT',
        // Name as UPLOAD_ID_HEADER in routes/videos.ts.
        headers: { 'X-Upload-Id': uploadId },
      };
    },
    async serve(key, request) {
      const object = await bucket.get(key, { range: request.headers });
      if (!object) return new Response(null, { status: 404 });
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      });
      object.writeHttpMetadata(headers);
      const range = object.range as { offset?: number; length?: number } | undefined;
      if (request.headers.has('Range') && range) {
        const offset = range.offset ?? 0;
        const length = range.length ?? object.size - offset;
        headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
        headers.set('Content-Length', String(length));
        return new Response(object.body, { status: 206, headers });
      }
      headers.set('Content-Length', String(object.size));
      return new Response(object.body, { headers });
    },
  };
}

/** True when the phone uploads through the Worker instead of directly to R2. */
export function uploadsThroughWorker(env: Env): boolean {
  return !(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID);
}

/** R2 object key of a video's original file. */
export function originalKey(videoId: string, contentType: string): string {
  return `videos/${videoId}/original.${contentType === 'video/webm' ? 'webm' : 'mp4'}`;
}
