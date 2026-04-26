/**
 * Thin wrapper around fetch that:
 *  - Prepends the backend base URL
 *  - Injects the Clerk JWT as Bearer token when provided
 */

export const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

type FetchOptions = RequestInit & { token?: string | null };

export async function apiFetch(
  path: string,
  { token, ...opts }: FetchOptions = {}
): Promise<Response> {
  const headers = new Headers(opts.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(`${API_BASE}${path}`, { ...opts, headers });
}
