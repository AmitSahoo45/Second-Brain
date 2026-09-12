import type { AppConfig } from '../config';

export function cookieValue(request: Request, name: string) {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  );
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
