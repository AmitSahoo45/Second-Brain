import { expect, test } from 'vitest';
import { cookieValue } from '../../src/auth/cookies';

test('reads an exact cookie name and ignores prefix names', () => {
  const request = new Request('http://127.0.0.1:8787/', {
    headers: {
      cookie: 'xowner_session=nope; owner_session=abc; other=1',
    },
  });
  expect(cookieValue(request, 'owner_session')).toBe('abc');
});

test('rejects oversized cookie headers and values without hashing', () => {
  const huge = new Request('http://127.0.0.1:8787/', {
    headers: { cookie: 'owner_session=' + 'a'.repeat(4096) },
  });
  expect(cookieValue(huge, 'owner_session')).toBe('');
  const longValue = new Request('http://127.0.0.1:8787/', {
    headers: { cookie: 'owner_session=' + 'a'.repeat(129) },
  });
  expect(cookieValue(longValue, 'owner_session')).toBe('');
});
