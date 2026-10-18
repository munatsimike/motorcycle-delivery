import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let loaded = false;

export function loadBackendEnv(): void {
  if (loaded) {
    return;
  }
  loaded = true;
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../.env'),
  ];
  for (const envFile of candidates) {
    if (!existsSync(envFile)) {
      continue;
    }
    process.loadEnvFile(envFile);
    return;
  }
}
