import { ConnectionsScreen } from './screens/Connections';
import { MemoryScreen } from './screens/Memory';
import { StatusScreen } from './screens/Status';

export function App(): string {
  return [MemoryScreen(), ConnectionsScreen(), StatusScreen()].join('');
}
