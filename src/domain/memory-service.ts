import { historyMemory, readMemory, searchMemory } from '../db/search';
import { executeMutation } from '../db/write-batch';
import { buildContext } from './context';
import type {
  AuthContext,
  ContextInput,
  HistoryInput,
  MemoryService,
  ReadInput,
  SaveInput,
  SearchInput,
  UpdateInput,
} from './types';

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
    context(ctx: AuthContext, input: ContextInput) {
      return buildContext(db, ctx, input, hmacSecret);
    },
    history(ctx: AuthContext, input: HistoryInput) {
      return historyMemory(db, ctx, input);
    },
  };
}
