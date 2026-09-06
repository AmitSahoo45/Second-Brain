import type { AuthContext } from '../auth/types';
import { assertProbeValueFits, maximumProbeRevision } from '../probe-encoding';

export class ProbeStore {
  constructor(
    private db: D1Database,
    private auth: AuthContext,
  ) {}

  private authorize(project: string, write = false) {
    if (
      !this.auth.project_ids.includes(project) ||
      !this.auth.scopes.includes('memory:read') ||
      (write && !this.auth.scopes.includes('memory:write'))
    )
      throw new Error('Access denied');
  }

  async read(project: string) {
    this.authorize(project);
    return (
      (await this.db
        .prepare(
          'SELECT value, revision FROM probe_values WHERE owner_id = ? AND project_id = ?',
        )
        .bind(this.auth.owner_id, project)
        .first<{ value: string; revision: number }>()) ?? {
        value: null,
        revision: 0,
      }
    );
  }

  async write(project: string, value: string) {
    this.authorize(project, true);
    assertProbeValueFits(value);
    const row = await this.db
      .prepare(
        "INSERT INTO probe_values (owner_id, project_id, value) VALUES (?, ?, ?) ON CONFLICT (owner_id, project_id) DO UPDATE SET value = excluded.value, revision = probe_values.revision + 1 WHERE typeof(probe_values.revision) = 'integer' AND probe_values.revision >= 1 AND probe_values.revision < ? RETURNING revision",
      )
      .bind(this.auth.owner_id, project, value, maximumProbeRevision)
      .first<{ revision: number }>();
    if (!row) throw new Error('Write failed');
    return row;
  }
}
