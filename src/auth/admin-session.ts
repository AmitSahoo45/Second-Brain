import type { ProbeEnv } from './types';
import { handleAdminRoutes } from '../admin/routes';

export async function handleAdminRequest(
  request: Request,
  env: ProbeEnv,
): Promise<Response | null> {
  return handleAdminRoutes(request, env);
}
