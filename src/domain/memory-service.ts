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

export function createMemoryService(db: D1Database): MemoryService {
  return {
    save(ctx: AuthContext, input: SaveInput) {
      return executeMutation(db, ctx, { operation: 'save', value: input });
    },
    update(ctx: AuthContext, input: UpdateInput) {
      return executeMutation(db, ctx, { operation: 'update', value: input });
    },
    read(_ctx: AuthContext, _input: ReadInput) {
      return unavailable();
    },
    search(_ctx: AuthContext, _input: SearchInput) {
      return unavailable();
    },
    context(_ctx: AuthContext, _input: ContextInput) {
      return unavailable();
    },
    history(_ctx: AuthContext, _input: HistoryInput) {
      return unavailable();
    },
  };
}
