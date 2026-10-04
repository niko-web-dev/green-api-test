import type userEvent from '@testing-library/user-event'
import type { createFakeClient } from './api/fakeClient'

export interface AppTestContext {
  user: ReturnType<typeof userEvent.setup>
  client: ReturnType<typeof createFakeClient>
}
