export const DEFAULT_UPLOAD_MAX_MB = 100;

/**
 * Maximum upload size in bytes, from UPLOAD_MAX_MB in .env.
 * The web container (nginx client_max_body_size) reads the same variable.
 */
export function getUploadMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.UPLOAD_MAX_MB);
  const megabytes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPLOAD_MAX_MB;
  return Math.floor(megabytes * 1024 * 1024);
}
