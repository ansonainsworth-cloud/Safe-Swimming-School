/**
 * Secrets are set with `wrangler secret put` and are not part of generated Env.
 * Names only. Values never belong in source, logs, or wrangler.jsonc.
 */
export interface SecretBindings {
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  SMS_ACCOUNT_SID?: string;
  SMS_AUTH_TOKEN?: string;
}

export function readSecret(env: Env, name: keyof SecretBindings): string {
  const bag = env as Env & SecretBindings;
  const value = bag[name];
  return typeof value === "string" ? value.trim() : "";
}
