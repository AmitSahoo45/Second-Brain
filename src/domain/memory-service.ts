import { historyMemory, readMemory, searchMemory } from '../db/search';
import { executeMutation } from '../db/write-batch';
import type {
  AuthContext,
  ContextInput,
  HistoryInput,
  MemoryService,
  Outcome,
  ReadInput,
  SaveInput,
  SearchInput,
  UpdateInput,
} from './types';

function unavailable<T>(): Promise<Outcome<T>> {
  return Promise.resolve({
    ok: false,
    error: {
      code: 'STORAGE_UNAVAILABLE',
      message: 'not implemented',
      retryable: false,
      request_id: crypto.randomUUID(),
    },
  });
}

export function createMemoryService(
  db: D1Database,
  hmacSecret: string,
): MemoryService {
  return {
    save(ctx: AuthContext, input: SaveInput) {
      return executeMutation(db, ctx, { operation: 'save', value: input });
    },
    update(ctx: AuthContext, input: UpdateInput) {
      return executeMutation(db, ctx, { operation: 'update', value: input });
    },
    read(ctx: AuthContext, input: ReadInput) {
      return readMemory(db, ctx, input);
    },
    search(ctx: AuthContext, input: SearchInput) {
      return searchMemory(db, ctx, input, hmacSecret);
    },
    context(_ctx: AuthContext, _input: ContextInput) {
      return unavailable();
    },
    history(ctx: AuthContext, input: HistoryInput) {
      return historyMemory(db, ctx, input);
    },
  };
}
