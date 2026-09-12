export type Id = string;
export type Instant = string;
export type Kind =
  'fact' | 'preference' | 'decision' | 'progress' | 'next_step' | 'question';
export type Lifecycle = 'active' | 'disputed' | 'archived';
export type Provenance =
  'user_stated' | 'source_supported' | 'inference' | 'unverified';
export type ActorKind = 'oauth_grant' | 'owner_admin';
export type Relation = 'supports' | 'contradicts' | 'related_to';
export type EvidenceKind =
  'user_message' | 'document' | 'code' | 'test_result' | 'assistant_report';

export interface EvidenceRef {
  kind: EvidenceKind;
  locator?: string;
  excerpt?: string;
  event_at?: Instant;
}

export interface RelatedRef {
  memory_id: Id;
  relation: Relation;
}

export interface NoteFields {
  title: string;
  body: string;
  kind: Kind;
  lifecycle: Lifecycle;
  provenance: Provenance;
  fact_key?: string;
  tags: string[];
  aliases: string[];
  evidence: EvidenceRef[];
  valid_from?: Instant;
  valid_until?: Instant;
  related: RelatedRef[];
}

export interface MemoryRecord extends NoteFields {
  memory_id: Id;
  project_id: Id;
  revision: number;
  created_at: Instant;
  updated_at: Instant;
  actor_id: Id;
  actor_kind: ActorKind;
  actor_client_label: string;
}

export interface WriteReceipt {
  operation_id: Id;
  memory_id: Id;
  project_id: Id;
  revision: number;
  committed_at: Instant;
  replayed: boolean;
}

export interface PurgeReceipt {
  operation_id: Id;
  memory_id: Id;
  project_id: Id;
  purged_revision: number;
  purged_at: Instant;
  replayed: boolean;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'FACT_KEY_EXISTS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PURGED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'MAINTENANCE_RETRY'
  | 'STORAGE_UNAVAILABLE'
  | 'RESPONSE_TOO_LARGE'
  | 'PROJECT_ARCHIVED';

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  request_id: Id;
  current_revision?: number;
  retry_after_ms?: number;
}

export type Outcome<T> =
  { ok: true; data: T; request_id: Id } | { ok: false; error: ErrorInfo };

export interface SearchCard {
  memory_id: Id;
  project_id: Id;
  revision: number;
  title: string;
  snippet: string;
  snippet_is_excerpt: boolean;
  kind: Kind;
  lifecycle: Lifecycle;
  provenance: Provenance;
  updated_at: Instant;
  valid_from?: Instant;
  valid_until?: Instant;
  evidence: EvidenceRef[];
  match_reason: 'fact_key' | 'title' | 'alias' | 'full_text';
}

export type ContextItem =
  | { representation: 'full'; record: MemoryRecord }
  | {
      representation: 'excerpt';
      card: SearchCard;
      expand_with: 'read_memory';
    };

export interface ProjectCard {
  project_id: Id;
  name: string;
  is_profile: boolean;
}

export interface ContextPack {
  items: ContextItem[];
  used_bytes: number;
  truncated: boolean;
  profile_included: boolean;
}

export type AuthContext =
  | {
      owner_id: Id;
      actor_id: Id;
      actor_kind: 'oauth_grant';
      actor_client_label: string;
      grant_id: Id;
      project_ids: readonly Id[];
      scopes: readonly string[];
    }
  | {
      owner_id: Id;
      actor_id: Id;
      actor_kind: 'owner_admin';
      actor_client_label: string;
      grant_id: null;
      project_ids: readonly Id[];
      scopes: readonly string[];
    };

export interface SaveInput {
  project_id: Id;
  note: NoteFields;
  operation_id: Id;
}

export interface UpdateInput extends SaveInput {
  memory_id: Id;
  expected_revision: number;
  reason: string;
}

export interface SearchInput {
  project_id: Id;
  query: string;
  kinds?: Kind[];
  lifecycle?: 'active' | 'disputed';
  limit?: number;
  cursor?: string;
}

export interface ReadInput {
  project_id: Id;
  memory_id: Id;
  revision?: number;
}

export interface HistoryInput {
  project_id: Id;
  memory_id: Id;
  limit?: number;
  before_revision?: number;
}

export interface ContextInput {
  project_id: Id;
  query: string;
  max_bytes?: number;
  include_profile?: boolean;
}

export interface MemoryService {
  save(ctx: AuthContext, input: SaveInput): Promise<Outcome<WriteReceipt>>;
  update(ctx: AuthContext, input: UpdateInput): Promise<Outcome<WriteReceipt>>;
  read(
    ctx: AuthContext,
    input: ReadInput,
  ): Promise<Outcome<{ record: MemoryRecord; historical: boolean }>>;
  search(
    ctx: AuthContext,
    input: SearchInput,
  ): Promise<
    Outcome<{ items: SearchCard[]; truncated: boolean; next_cursor?: string }>
  >;
  context(ctx: AuthContext, input: ContextInput): Promise<Outcome<ContextPack>>;
  history(
    ctx: AuthContext,
    input: HistoryInput,
  ): Promise<
    Outcome<{
      revisions: {
        revision: number;
        recorded_at: Instant;
        reason: string;
        provenance: Provenance;
      }[];
      next_before_revision?: number;
    }>
  >;
}
