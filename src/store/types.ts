import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit'
import type { Credentials, GreenApiClient } from '../api/types'
import type { MessengerId } from '../messengers/types'
import type { DeliveryStatus, IncomingText } from '../notifications/types'
import type { makeStore } from './index'

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

export type AppThunk<R = void> = ThunkAction<
  R,
  StoreState,
  StoreExtra,
  UnknownAction
>

export interface Chat {
  chatId: string
  title: string
  phone?: string
  lastActivity: number
}

export interface Message {
  key: string
  chatId: string
  direction: 'in' | 'out'
  text: string
  timestamp: number
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown'
  idMessage?: string
  error?: string
}

export interface ChatsState {
  byId: Record<string, Chat>
  openRequestId: string | null
  activeChatId: string | null
  messagesByChat: Record<string, Message[]>
  seenMessageIds: Record<string, true>
  pendingStatuses: PendingMessageStatus[]
  error: string | null
}

export type AppStore = ReturnType<typeof makeStore>

export type RootState = StoreState

export type AppDispatch = AppStore['dispatch']

export interface Session {
  messenger: MessengerId
  credentials: Credentials
}

export interface SessionState {
  current: Session | null
  sessionId: number
  connection: 'idle' | 'online' | 'reconnecting' | 'error' | 'standby'
  error: string | null
  warning: string | null
  loginRequestId: string | null
}

export type OperationConfig = {
  state: StoreState
  extra: StoreExtra
  rejectValue: string
}

export type SendArg = SessionScope & {
  chatId: string
  text: string
  // Передаёт только retrySend, проверив, что повтор допустим.
  retryKey?: string
}

export type SendError = { status: 'failed' | 'unknown'; error: string }

export type LoginArg = Session & SessionScope

export type OpenChatArg = SessionScope & { phoneInput: string }

export type RetrySendArg = SessionScope & { key: string }

export interface SessionConditionApi {
  getState(): StoreState
}

export interface ScopedActionMeta {
  arg?: { sessionId?: unknown }
}

export interface ScopedActionPayload {
  sessionId?: unknown
}

export type ConnectionChangedPayload = SessionScope & {
  connection: SessionState['connection']
  error?: string | null
}

export type WarningChangedPayload = SessionScope & { warning: string | null }

export type IncomingReceivedPayload = SessionScope & IncomingText

export interface PendingMessageStatus {
  chatId: string
  idMessage: string
  status: DeliveryStatus
}

export type MessageStatusUpdatedPayload = PendingMessageStatus &
  Partial<SessionScope>

export type OutgoingStartedPayload = SessionScope & {
  message: Message
  retryKey?: string
}

export interface SendResult {
  chatId: string
  key: string
  idMessage: string
}

export type SendConfig = {
  state: StoreState
  extra: StoreExtra
  rejectValue: SendError
}
