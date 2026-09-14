import type { Outcome } from '../../src/domain/types';

export const browserAdminFetchSource = `async function adminFetch(path, init) {
  const headers = Object.assign({ accept: 'application/json', 'x-csrf-token': state.csrf }, init && init.headers || {});
  const response = await fetch(path, Object.assign({}, init, { headers }));
  if (response.status === 403) throw new Error('sign-in required');
  return response.json();
}`;

export async function adminFetch<T>(
  path: string,
  init: RequestInit = {},
  csrf = '',
): Promise<Outcome<T>> {
  const headers = new Headers(init.headers);
  if (csrf) headers.set('x-csrf-token', csrf);
  const response = await fetch(path, { ...init, headers });
  return (await response.json()) as Outcome<T>;
}
