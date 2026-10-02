export function pickMigrationUrl(env: Record<string, string | undefined>): string | undefined;
export function withMigrationLock<T>(options: {
  lock: () => Promise<unknown>;
  unlock: () => Promise<unknown>;
  end: () => Promise<unknown>;
  work: () => Promise<T>;
  log?: (message: string) => void;
}): Promise<T>;
