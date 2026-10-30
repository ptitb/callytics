/**
 * ARI credentials from the environment.
 *
 * docker compose passes ARI_PASS. The older name ARI_PASSWORD is still accepted
 * so existing installations keep working. Reading one name in one service and
 * the other name elsewhere made health checks fall back to the default
 * password and report ARI as disconnected.
 */
export interface AriCredentials {
  user: string;
  password: string;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value) => Boolean(value));
}

export function getAriCredentials(env: NodeJS.ProcessEnv = process.env): AriCredentials {
  return {
    user: firstNonEmpty(env.ARI_USER) ?? 'callytics',
    password: firstNonEmpty(env.ARI_PASS, env.ARI_PASSWORD) ?? 'callytics',
  };
}
