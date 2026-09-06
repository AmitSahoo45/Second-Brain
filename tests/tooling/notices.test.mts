import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/check-dependencies.mts');
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'shared-memory-notices-'));
  await writeFile(
    join(cwd, 'package.json'),
    JSON.stringify({ dependencies: {}, devDependencies: {} }),
  );
  await writeFile(
    join(cwd, 'package-lock.json'),
    JSON.stringify({ packages: {} }),
  );
  await writeFile(
    join(cwd, 'THIRD_PARTY_NOTICES.md'),
    'Existing required notice text\n',
  );
  return cwd;
}
test('missing required supplements fail before overwriting existing notices', async () => {
  const cwd = await fixture();
  const result = spawnSync(process.execPath, [script, '--write-notices'], {
    cwd,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.equal(
    await readFile(join(cwd, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    'Existing required notice text\n',
  );
});
test('clean-checkout generation includes complete tracked upstream texts without ignored evidence', async () => {
  const cwd = await fixture();
  await cp(
    resolve('third-party/workers-sdk'),
    join(cwd, 'third-party/workers-sdk'),
    { recursive: true },
  );
  const result = spawnSync(process.execPath, [script, '--write-notices'], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const generated = await readFile(join(cwd, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  for (const file of ['LICENSE-MIT', 'LICENSE-APACHE'])
    assert.ok(
      generated.includes(
        (
          await readFile(resolve('third-party/workers-sdk', file), 'utf8')
        ).trimEnd(),
      ),
    );
});
