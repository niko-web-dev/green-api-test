import type { PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice, isAnyOf } from '@reduxjs/toolkit'
import { loggedOut, sessionStarted } from './sessionSlice'
import type { openChat, sendMessage } from './thunks'
import type {
  ChatsState,
  IncomingReceivedPayload,
  Message,
  MessageStatusUpdatedPayload,
  OutgoingStartedPayload,
  StoreState,
} from './types'

const initialState: ChatsState = {
  byId: {},
  openRequestId: null,
  activeChatId: null,
  messagesByChat: {},
  seenMessageIds: {},
  error: null,
}

const statusRank: Record<Message['status'], number> = {
  sending: 0,
  failed: 0,
  unknown: 0,
  sent: 1,
  delivered: 2,
  read: 3,
}

const slice = createSlice({
  name: 'chats',
  initialState,
  reducers: {
    chatSelected(state, action: PayloadAction<string | null>) {
      if (action.payload === null || Object.hasOwn(state.byId, action.payload))
        state.activeChatId = action.payload
    },
    incomingReceived(state, action: PayloadAction<IncomingReceivedPayload>) {
      const p = action.payload
      if (Object.hasOwn(state.seenMessageIds, p.idMessage)) return
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
    },
    messageStatusUpdated(
      state,
      action: PayloadAction<MessageStatusUpdatedPayload>,
    ) {
      const { idMessage, status } = action.payload
      for (const messages of Object.values(state.messagesByChat)) {
        const message = messages.find(
          (m) => m.direction === 'out' && m.idMessage === idMessage,
        )
        if (!message) continue
        if (statusRank[status] > statusRank[message.status]) {
          message.status = status
          delete message.error
        }
        return
      }
    },
    outgoingStarted(state, action: PayloadAction<OutgoingStartedPayload>) {
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
    },
  },
  extraReducers: (builder) => {
    builder.addMatcher(isAnyOf(sessionStarted, loggedOut), () => initialState)
    builder.addMatcher(
      (action): action is ReturnType<typeof openChat.pending> =>
        action.type === 'chats/open/pending',
      (state, action) => {
        state.openRequestId = action.meta.requestId
        state.error = null
      },
    )
    builder.addMatcher(
      (action): action is ReturnType<typeof openChat.fulfilled> =>
        action.type === 'chats/open/fulfilled',
      (state, action) => {
        if (state.openRequestId !== action.meta.requestId) return
        state.openRequestId = null
        const chat = action.payload
        const existing = state.byId[chat.chatId]
        if (existing) existing.phone = chat.phone
        else state.byId[chat.chatId] = chat
        state.activeChatId = chat.chatId
        state.error = null
      },
    )
    builder.addMatcher(
      (action): action is ReturnType<typeof sendMessage.fulfilled> =>
        action.type === 'chats/send/fulfilled',
      (state, action) => {
        const { chatId, key, idMessage } = action.payload
        const message = state.messagesByChat[chatId]?.find((m) => m.key === key)
        if (!message) return
        if (statusRank[message.status] < statusRank.sent)
          message.status = 'sent'
        message.idMessage = idMessage
        delete message.error
      },
    )
    builder.addMatcher(
      (action): action is ReturnType<typeof sendMessage.rejected> =>
        action.type === 'chats/send/rejected',
      (state, action) => {
        const message = state.messagesByChat[action.meta.arg.chatId]?.find(
          (m) => m.key === (action.meta.arg.retryKey ?? action.meta.requestId),
        )
        const error =
          action.payload?.error ?? 'Не удалось подтвердить отправку.'
        if (message?.status === 'sending') {
          message.status = action.payload?.status ?? 'unknown'
          message.error = error
        } else if (!message) {
          state.error = error
        }
      },
    )
    builder.addMatcher(
      (action): action is ReturnType<typeof openChat.rejected> =>
        action.type === 'chats/open/rejected',
      (state, action) => {
        if (state.openRequestId !== action.meta.requestId) return
        state.openRequestId = null
        state.error = action.payload ?? 'Не удалось открыть чат.'
      },
    )
  },
})

export const {
  incomingReceived,
  outgoingStarted,
  chatSelected,
  messageStatusUpdated,
} = slice.actions
export default slice.reducer

export const selectChatList = createSelector(
  [(state: StoreState) => state.chats.byId],
  (byId) => Object.values(byId).sort((a, b) => b.lastActivity - a.lastActivity),
)

export const selectActiveChat = (state: StoreState) =>
  state.chats.activeChatId
    ? state.chats.byId[state.chats.activeChatId]
    : undefined
const emptyMessages: Message[] = []
export const selectActiveMessages = (state: StoreState) =>
  (state.chats.activeChatId &&
    state.chats.messagesByChat[state.chats.activeChatId]) ||
  emptyMessages
