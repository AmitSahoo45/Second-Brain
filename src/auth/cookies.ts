import type { AppConfig } from '../config';

const encoder = new TextEncoder();
const maximumCookieHeaderBytes = 4096;
const maximumCookieValueBytes = 128;

export function cookieValue(request: Request, name: string) {
  const header = request.headers.get('cookie');
  if (!header || encoder.encode(header).byteLength > maximumCookieHeaderBytes)
    return '';
  for (const item of header.split(';')) {
    const trimmed = item.trim();
    const separator = trimmed.indexOf('=');
    if (separator <= 0 || trimmed.slice(0, separator) !== name) continue;
    const value = trimmed.slice(separator + 1);
    if (encoder.encode(value).byteLength > maximumCookieValueBytes) return '';
    return value;
  }
  return '';
}

export function sessionCookie(
  name: string,
  value: string,
  config: AppConfig,
  expires = false,
  maxAge = 600,
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires ? 0 : maxAge}${config.origin.startsWith('https:') ? '; Secure' : ''}`;
}
