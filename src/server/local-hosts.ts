// The hostnames a local run uses. Dev-only paths (the Google mock, localhost passkeys) check
// against this one list.

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const isLocalHostname = (hostname: string): boolean => LOCAL_HOSTS.has(hostname);
