import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface PackageInfo {
  name?: string;
  version: string;
  license?: string;
  repository?: unknown;
  gitHead?: string;
}
interface Locked {
  version: string;
  integrity?: string;
  resolved?: string;
  dev?: boolean;
}
const checked = new Date().toISOString();
const root = JSON.parse(await readFile('package.json', 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as {
  packages: Record<string, Locked>;
};
const direct = { ...root.dependencies, ...root.devDependencies };
for (const [name, pin] of Object.entries(direct)) {
  if (!/^\d+\.\d+\.\d+$/.test(pin))
    throw new Error(
      `Direct package must use an exact released version: ${name}`,
    );
  if (lock.packages[`node_modules/${name}`]?.version !== pin)
    throw new Error(`Lock mismatch: ${name}`);
}
const inventory: unknown[] = [];
const licenses = new Map<string, { text: string; packages: string[] }>();
for (const [path, locked] of Object.entries(lock.packages)) {
  if (!path) continue;
  if (
    !locked.integrity ||
    !locked.resolved?.startsWith('https://registry.npmjs.org/')
  )
    throw new Error(`Missing registry provenance: ${path}`);
  let manifest: PackageInfo;
  try {
    manifest = JSON.parse(
      await readFile(join(path, 'package.json'), 'utf8'),
    ) as PackageInfo;
  } catch {
    inventory.push({ path, ...locked, installed: false });
    continue;
  }
  if (manifest.version !== locked.version)
    throw new Error(`Installed artifact version mismatch: ${path}`);
  const files: { file: string; sha256: string }[] = [];
  for (const filename of await readdir(path)) {
    if (
      !/license|notice|copyright/i.test(filename) ||
      !(await stat(join(path, filename))).isFile()
    )
      continue;
    const content = await readFile(join(path, filename), 'utf8');
    const digest = createHash('sha256').update(content).digest('hex');
    const identity = `${manifest.name ?? path}@${manifest.version}/${filename}`;
    files.push({ file: filename, sha256: digest });
    const existing = licenses.get(digest);
    if (existing) existing.packages.push(identity);
    else licenses.set(digest, { text: content, packages: [identity] });
  }
  inventory.push({
    path,
    name: manifest.name,
    ...locked,
    installed: true,
    direct: Boolean(manifest.name && direct[manifest.name]),
    licenseMetadata: manifest.license ?? null,
    licenseFiles: files,
    bundledLicenseMissing: files.length === 0,
    repository: manifest.repository ?? null,
    sourceCommit: manifest.gitHead ?? null,
    sourceRelease: `${manifest.name ?? path}@${manifest.version}`,
  });
}
await mkdir('evidence', { recursive: true });
await writeFile(
  'evidence/dependencies.json',
  JSON.stringify(
    {
      checked,
      node: process.version,
      packageManager: 'npm@11.19.1',
      provenance:
        'Locked registry tarballs and installed artifacts. SRI is supplied by the lock; npm ci verified installation. Repository release labels are not verified Git tags. Null sourceCommit means unavailable in installed metadata.',
      knownDiscrepancies: [
        'MCP v2 LICENSE describes Apache-2.0 transition, residual MIT and CC-BY-4.0 documentation despite MIT package metadata.',
        'Cloudflare released tooling pins prerelease Miniflare 5.20260903.0-alpha; retained without overrides.',
        'Workers SDK tooling archives can omit license files; see immutable upstream license supplements.',
      ],
      packages: inventory,
    },
    null,
    2,
  ) + '\n',
);
let notices =
  '# Third-party notices\n\nGenerated from actual installed artifacts by `npm run check:dependencies`. Exact packages and registry integrity hashes are in package-lock.json; regenerated detailed inventory is in evidence/dependencies.json. No third-party application snippets were copied.\n\nSDK v2 package manifests declare MIT, while shipped LICENSE files describe an Apache-2.0 transition, residual MIT contributions and CC-BY-4.0 documentation; the full shipped text below controls this disclosure. Released Cloudflare tooling pins prerelease Miniflare 5.20260903.0-alpha. Missing bundled licenses are explicitly recorded in the inventory, not inferred to be absent upstream.\n\n';
for (const [digest, entry] of licenses)
  notices += `## License text ${digest.slice(0, 12)}\n\nArtifacts: ${entry.packages.join(', ')}\n\n\`\`\`text\n${entry.text.trimEnd()}\n\`\`\`\n\n`;
for (const filename of ['LICENSE-MIT', 'LICENSE-APACHE']) {
  try {
    const value = await readFile(
      join('evidence/research/upstream-licenses', filename),
      'utf8',
    );
    notices += `## Workers SDK upstream ${filename}\n\nSupplement for package archives missing bundled license text; source commit be87ff0382c53a294e948e49419d25d653c50e86, https://github.com/cloudflare/workers-sdk/blob/be87ff0382c53a294e948e49419d25d653c50e86/${filename}\n\n\`\`\`text\n${value.trimEnd()}\n\`\`\`\n\n`;
  } catch {
    /* Optional local evidence; existing supplement below remains stable. */
  }
}
// A check refreshes machine evidence. Notice regeneration is an explicit reviewable action.
if (process.argv.includes('--write-notices'))
  await writeFile('THIRD_PARTY_NOTICES.md', notices);
console.log(
  `Inventoried ${inventory.length} locked packages and ${licenses.size} distinct shipped license/notice texts. Direct pins and installed versions match.`,
);
