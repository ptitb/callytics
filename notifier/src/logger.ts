export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Writes one line per message to stdout/stderr so `docker compose logs notifier` stays readable. */
export const consoleLogger: Logger = {
  info: (message) => console.log(`[notifier] ${message}`),
  warn: (message) => console.warn(`[notifier] WARN ${message}`),
  error: (message) => console.error(`[notifier] ERROR ${message}`),
};
