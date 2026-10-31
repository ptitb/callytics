import { HttpError } from './errors';

/**
 * SSRF guard. The recording URL arrives in a webhook body, so it is untrusted input.
 * Only the exact download URL shape of the configured Callytics backend is accepted:
 * `<BACKEND_URL>/recordings/<numeric id>/download`, without credentials, query or fragment.
 */
export function assertBackendRecordingUrl(rawUrl: string, backendUrl: string): URL {
  let url: URL;
  let backend: URL;
  try {
    url = new URL(rawUrl);
    backend = new URL(backendUrl);
  } catch {
    throw new HttpError(400, 'recording.url is not a valid URL');
  }

  const backendPath = backend.pathname.replace(/\/+$/, '');
  const pathPattern = new RegExp(`^${escapeRegExp(backendPath)}/recordings/\\d+/download$`);

  const allowed =
    url.origin === backend.origin
    && !url.username
    && !url.password
    && !url.search
    && !url.hash
    && pathPattern.test(url.pathname);

  if (!allowed) {
    throw new HttpError(400, 'recording.url does not point to the configured backend');
  }
  return url;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
