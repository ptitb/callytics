import { HttpError } from './errors';

export type FetchFn = typeof fetch;

export interface DownloadOptions {
  maxBytes?: number;
  timeoutMs?: number;
  fetchFn?: FetchFn;
}

/**
 * Downloads a recording from the backend. The URL must already have passed the SSRF guard.
 * Redirects are not followed, so the backend cannot bounce the request to another host.
 */
export async function downloadRecording(url: URL, options: DownloadOptions = {}): Promise<Buffer> {
  const { maxBytes = 25 * 1024 * 1024, timeoutMs = 15_000, fetchFn = fetch } = options;

  let response: Response;
  try {
    response = await fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new HttpError(502, `Recording download failed: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new HttpError(502, `Recording download failed with status ${response.status}`);
  }

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    throw new HttpError(502, 'Recording is larger than the allowed size');
  }
  if (!response.body) {
    throw new HttpError(502, 'Recording download returned no body');
  }

  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      if (received > maxBytes) {
        throw new HttpError(502, 'Recording is larger than the allowed size');
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `Recording download failed: ${(error as Error).message}`);
  }
  if (received === 0) {
    throw new HttpError(502, 'Recording is empty');
  }
  return Buffer.concat(chunks);
}
