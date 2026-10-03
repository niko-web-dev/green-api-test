import type { GreenApiClient } from '../api/greenApiClient'
import type { Credentials } from '../api/types'
import type { SessionState } from './sessionSlice'
import type { ChatsState } from './chatsSlice'

export interface StoreState {
  session: SessionState
  chats: ChatsState
}

export interface StoreDependencies {
  createClient(credentials: Credentials): GreenApiClient
}

export interface StoreExtra extends StoreDependencies {
  getSignal(): AbortSignal
}

export interface SessionScope {
  sessionId: number
}
