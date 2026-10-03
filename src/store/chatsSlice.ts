import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { IncomingText } from '../notifications'
import { sessionStarted, loggedOut } from './sessionSlice'
import type { SessionScope } from './types'
import type { openChatOperation, sendMessageOperation } from './thunks'

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
  status: 'sending' | 'sent' | 'failed' | 'unknown'
  idMessage?: string
  error?: string
}

export interface ChatsState {
  sessionId: number
  byId: Record<string, Chat>
  order: string[]
  activeChatId: string | null
  messagesByChat: Record<string, Message[]>
  seenMessageIds: Record<string, true>
  error: string | null
}

const initialState: ChatsState = {
  sessionId: 0,
  byId: {},
  order: [],
  activeChatId: null,
  messagesByChat: {},
  seenMessageIds: {},
  error: null,
}

function sortChats(state: ChatsState) {
  state.order = Object.values(state.byId)
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map((chat) => chat.chatId)
}

const slice = createSlice({
  name: 'chats',
  initialState,
  reducers: {
    incomingReceived(
      state,
      action: PayloadAction<SessionScope & IncomingText>,
    ) {
      const p = action.payload
      if (
        p.sessionId !== state.sessionId ||
        Object.hasOwn(state.seenMessageIds, p.idMessage)
      )
        return
      state.seenMessageIds[p.idMessage] = true
      state.byId[p.chatId] ??= {
        chatId: p.chatId,
        title: p.chatName,
        lastActivity: p.timestamp,
      }
      const chat = state.byId[p.chatId]!
      chat.lastActivity = Math.max(chat.lastActivity, p.timestamp)
      const messages = (state.messagesByChat[p.chatId] ??= [])
      messages.push({
        key: p.idMessage,
        idMessage: p.idMessage,
        chatId: p.chatId,
        direction: 'in',
        text: p.text,
        timestamp: p.timestamp,
        status: 'sent',
      })
      messages.sort((a, b) => a.timestamp - b.timestamp)
      sortChats(state)
    },
    outgoingStarted(
      state,
      action: PayloadAction<
        SessionScope & { message: Message; retryKey?: string }
      >,
    ) {
      if (action.payload.sessionId !== state.sessionId) return
      const { message, retryKey } = action.payload
      const messages = (state.messagesByChat[message.chatId] ??= [])
      const previous = retryKey
        ? messages.find((m) => m.key === retryKey)
        : undefined
      if (previous) Object.assign(previous, message, { error: undefined })
      else messages.push(message)
      messages.sort((a, b) => a.timestamp - b.timestamp)
      const chat = state.byId[message.chatId]
      if (chat)
        chat.lastActivity = Math.max(chat.lastActivity, message.timestamp)
      state.error = null
      sortChats(state)
    },
  },
  extraReducers: (builder) => {
    builder.addCase(sessionStarted, (state) => ({
      ...initialState,
      sessionId: state.sessionId + 1,
    }))
    builder.addCase(loggedOut, (state) => ({
      ...initialState,
      sessionId: state.sessionId + 1,
    }))
    builder.addMatcher(
      (action): action is ReturnType<typeof openChatOperation.fulfilled> =>
        action.type === 'chats/open/fulfilled',
      (state, action) => {
        if (action.meta.arg.sessionId !== state.sessionId) return
        const chat = action.payload
        const existing = state.byId[chat.chatId]
        if (existing) existing.phone = chat.phone
        else state.byId[chat.chatId] = chat
        state.activeChatId = chat.chatId
        state.error = null
        sortChats(state)
      },
    )
    builder.addMatcher(
      (action): action is ReturnType<typeof sendMessageOperation.fulfilled> =>
        action.type === 'chats/send/fulfilled',
      (state, action) => {
        if (action.meta.arg.sessionId !== state.sessionId) return
        const { chatId, key, idMessage } = action.payload
        const message = state.messagesByChat[chatId]?.find((m) => m.key === key)
        if (!message) return
        message.status = 'sent'
        message.idMessage = idMessage
        delete message.error
        state.seenMessageIds[idMessage] = true
      },
    )
    builder.addMatcher(
      (action): action is ReturnType<typeof sendMessageOperation.rejected> =>
        action.type === 'chats/send/rejected',
      (state, action) => {
        if (action.meta.arg.sessionId !== state.sessionId) return
        const message = state.messagesByChat[action.meta.arg.chatId]?.find(
          (m) => m.key === (action.meta.arg.retryKey ?? action.meta.requestId),
        )
        if (message && message.status === 'sending') {
          message.status = action.payload?.status ?? 'unknown'
          message.error =
            action.payload?.error ?? 'Не удалось подтвердить отправку.'
        }
        state.error =
          action.payload?.error ?? 'Не удалось подтвердить отправку.'
      },
    )
    builder.addMatcher(
      (action): action is ReturnType<typeof openChatOperation.rejected> =>
        action.type === 'chats/open/rejected',
      (state, action) => {
        if (action.meta.arg.sessionId !== state.sessionId) return
        state.error = action.payload ?? 'Не удалось открыть чат.'
      },
    )
  },
})

export const { incomingReceived, outgoingStarted } = slice.actions
export default slice.reducer
