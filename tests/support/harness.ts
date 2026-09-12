import { env } from 'cloudflare:workers';
import authSql from '../../src/db/migrations/0001_auth.sql?raw';
import boundsSql from '../../src/db/migrations/0002_probe_auth_bounds.sql?raw';
import sessionSql from '../../src/db/migrations/0003_owner_sessions.sql?raw';
import memorySql from '../../src/db/migrations/0004_memory.sql?raw';
import opsSql from '../../src/db/migrations/0005_ops.sql?raw';
import {
  executeMutation,
  type FailStage,
  type WriteFault,
} from '../../src/db/write-batch';
import {
  archiveProject,
  memoryCounts,
  revokeGrantRow,
} from '../../src/db/repository';
import { createMemoryService } from '../../src/domain/memory-service';
import type {
  AuthContext,
  MemoryService,
  NoteFields,
  WriteReceipt,
} from '../../src/domain/types';
import { validSyntheticNote } from './fixtures';

export interface Harness {
  service: MemoryService;
  ctx: AuthContext;
  otherCtx: AuthContext;
  projectId: string;
  otherProjectId: string;
  note(overrides?: Partial<NoteFields>): NoteFields;
  seed(note?: Partial<NoteFields>): Promise<WriteReceipt>;
  counts(memoryId: string): Promise<{
    current: number;
    revisions: number;
    fts: number;
    receipts: number;
  }>;
  failNext(stage: 'revision' | 'fts' | 'audit' | 'receipt'): void;
  archiveProject(): Promise<void>;
  revokeActor(): Promise<void>;
  dispose(): Promise<void>;
}

async function execSql(db: D1Database, sql: string): Promise<void> {
  for (const statement of sql
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
}

async function ensureMigrated(db: D1Database): Promise<void> {
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' OR type = 'view'",
    )
    .all<{ name: string }>();
  const names = new Set(tables.results.map((row) => row.name));
  if (!names.has('owners')) await execSql(db, authSql + boundsSql + sessionSql);
  if (!names.has('memories')) await execSql(db, memorySql);
  if (!names.has('mutation_receipts')) await execSql(db, opsSql);
}

async function insertOwner(
  db: D1Database,
  label: string,
): Promise<{
  ctx: AuthContext;
  projectId: string;
  grantId: string;
}> {
  const now = new Date().toISOString();
  const ownerId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const grantId = crypto.randomUUID();
  const subject = String(1000000000 + Math.floor(Math.random() * 1000000000));
  await db.batch([
    db
      .prepare(
        'INSERT INTO owners (owner_id, provider, provider_subject, admin_actor_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(ownerId, 'github', subject, adminId, now),
    db
      .prepare(
        'INSERT INTO projects (project_id, owner_id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(projectId, ownerId, label, label.toLowerCase(), now, now),
    db
      .prepare(
        'INSERT INTO grants (grant_id, owner_id, client_id, client_label, scopes_json, issued_epoch, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
      )
      .bind(
        grantId,
        ownerId,
        'synthetic-client',
        'Synthetic',
        JSON.stringify(['memory:read', 'memory:write']),
        now,
      ),
    db
      .prepare(
        'INSERT INTO grant_projects (grant_id, owner_id, project_id) VALUES (?, ?, ?)',
      )
      .bind(grantId, ownerId, projectId),
  ]);
  return {
    projectId,
    grantId,
    ctx: {
      owner_id: ownerId,
      actor_id: grantId,
      actor_kind: 'oauth_grant',
      actor_client_label: 'Synthetic',
      grant_id: grantId,
      project_ids: [projectId],
      scopes: ['memory:read', 'memory:write'],
    },
  };
}

export async function createHarness(): Promise<Harness> {
  const db = env.DB;
  await ensureMigrated(db);
  const owner = await insertOwner(db, 'Synthetic T03 primary');
  const other = await insertOwner(db, 'Synthetic T03 other');
  const pending: { stage?: FailStage } = {};
  const fault: WriteFault = {
    before(stage, attemptId, database) {
      if (pending.stage !== stage) return;
      delete pending.stage;
      return database
        .prepare(
          'INSERT INTO write_assertions (attempt_id, applied) VALUES (?, 0)',
        )
        .bind(`${stage}:${attemptId}`);
    },
  };
  const base = createMemoryService(db);
  const service: MemoryService = {
    ...base,
    save(ctx, input) {
      return executeMutation(
        db,
        ctx,
        { operation: 'save', value: input },
        fault,
      );
    },
    update(ctx, input) {
      return executeMutation(
        db,
        ctx,
        { operation: 'update', value: input },
        fault,
      );
    },
  };
  return {
    service,
    ctx: owner.ctx,
    otherCtx: other.ctx,
    projectId: owner.projectId,
    otherProjectId: other.projectId,
    note(overrides?: Partial<NoteFields>) {
      return validSyntheticNote(overrides);
    },
    async seed(note?: Partial<NoteFields>): Promise<WriteReceipt> {
      const result = await service.save(owner.ctx, {
        project_id: owner.projectId,
        note: validSyntheticNote(note),
        operation_id: crypto.randomUUID(),
      });
      if (!result.ok) throw new Error(result.error.code);
      return result.data;
    },
    counts(memoryId: string) {
      return memoryCounts(db, owner.ctx.owner_id, memoryId);
    },
    failNext(stage: FailStage) {
      pending.stage = stage;
    },
    archiveProject() {
      return archiveProject(db, owner.ctx.owner_id, owner.projectId);
    },
    revokeActor() {
      return revokeGrantRow(db, owner.ctx.owner_id, owner.grantId);
    },
    async dispose() {
      await db.batch([
        db
          .prepare('DELETE FROM memory_relations WHERE owner_id IN (?, ?)')
          .bind(owner.ctx.owner_id, other.ctx.owner_id),
        db
          .prepare(
            'DELETE FROM memory_fts WHERE rowid IN (SELECT rowid FROM memories WHERE owner_id IN (?, ?))',
          )
          .bind(owner.ctx.owner_id, other.ctx.owner_id),
        db
          .prepare('DELETE FROM mutation_receipts WHERE owner_id IN (?, ?)')
          .bind(owner.ctx.owner_id, other.ctx.owner_id),
        db
          .prepare('DELETE FROM memory_revisions WHERE owner_id IN (?, ?)')
          .bind(owner.ctx.owner_id, other.ctx.owner_id),
        db
          .prepare('DELETE FROM memories WHERE owner_id IN (?, ?)')
          .bind(owner.ctx.owner_id, other.ctx.owner_id),
      ]);
    },
  };
}
