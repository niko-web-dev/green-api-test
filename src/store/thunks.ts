import { createAsyncThunk } from '@reduxjs/toolkit'
import { GreenApiError, describeError } from '../api/greenApiClient'
import { MESSENGERS, normalizePhone, validatePhone } from '../messengers'
import { readSession, saveSession, sessionStarted } from './sessionSlice'
import type { Session } from './sessionSlice'
import { outgoingStarted } from './chatsSlice'
import type { Chat } from './chatsSlice'
import type { StoreState, StoreExtra, SessionScope, AppThunk } from './types'

type Config = { state: StoreState; extra: StoreExtra; rejectValue: string }
const createOperation = createAsyncThunk.withTypes<Config>()
const currentSessionOnly = {
  condition: (arg: SessionScope, api: { getState(): StoreState }) =>
    arg.sessionId === api.getState().session.sessionId,
}

const stateErrors: Record<string, string> = {
  notAuthorized:
    'Инстанс не авторизован. Авторизуйте аккаунт в кабинете GREEN-API.',
  blocked: 'Аккаунт заблокирован. Проверьте состояние в кабинете GREEN-API.',
  starting: 'Инстанс запускается. Попробуйте войти позже.',
  sleepMode: 'Инстанс в спящем режиме. Активируйте его в кабинете GREEN-API.',
  yellowCard:
    'Работа аккаунта ограничена. Проверьте состояние в кабинете GREEN-API.',
}

export const login = createOperation<void, Session & SessionScope>(
  'session/login',
  async (arg, api) => {
    try {
      const signal = AbortSignal.any([api.signal, api.extra.getSignal()])
      const state = await api.extra
        .createClient(arg.credentials)
        .getStateInstance(signal)
      if (
        signal.aborted ||
        api.getState().session.sessionId !== arg.sessionId ||
        api.getState().session.loginRequestId !== api.requestId
      )
        return
      if (state !== 'authorized')
        return api.rejectWithValue(
          stateErrors[state] ??
            'Инстанс пока не готов к работе. Проверьте его состояние в кабинете GREEN-API.',
        )
      api.dispatch(
        sessionStarted({
          messenger: arg.messenger,
          credentials: arg.credentials,
        }),
      )
    } catch (error) {
      return api.rejectWithValue(describeError(error))
    }
  },
  currentSessionOnly,
)

export const restoreSession =
  (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    const saved = readSession()
    if (!saved) return
    const sessionId = getState().session.sessionId
    const result = await dispatch(login({ ...saved, sessionId }))
    // Иначе перезагрузка повторит заведомо неудачный вход.
    if (
      login.rejected.match(result) &&
      !result.meta.aborted &&
      !result.meta.condition &&
      getState().session.sessionId === sessionId &&
      !getState().session.loginRequestId
    )
      saveSession(null)
  }

export const openChat = createOperation<
  Chat,
  SessionScope & { phoneInput: string }
>(
  'chats/open',
  async (arg, api) => {
    const current = api.getState().session.current
    if (!current) return api.rejectWithValue('Сначала выполните вход.')
    const profile = MESSENGERS[current.messenger]
    const phone = normalizePhone(arg.phoneInput)
    const invalid = validatePhone(phone)
    if (invalid) return api.rejectWithValue(invalid)
    const cached = Object.values(api.getState().chats.byId).find(
      (chat) => chat.phone === phone,
    )
    if (cached) return cached
    try {
      const signal = AbortSignal.any([api.signal, api.extra.getSignal()])
      const resolved = await profile.resolveChat(
        api.extra.createClient(current.credentials),
        phone,
        signal,
      )
      if (!resolved)
        return api.rejectWithValue(
          `Номер не зарегистрирован в ${profile.title}`,
        )
      return { ...resolved, phone, lastActivity: Date.now() / 1000 }
    } catch (error) {
      return api.rejectWithValue(
        describeError(error, 'Не удалось проверить номер.'),
      )
    }
  },
  currentSessionOnly,
)

type SendArg = SessionScope & {
  chatId: string
  text: string
  // Передаёт только retrySend, проверив, что повтор допустим.
  retryKey?: string
}
type SendError = { status: 'failed' | 'unknown'; error: string }
export const sendMessage = createAsyncThunk<
  { chatId: string; key: string; idMessage: string },
  SendArg,
  { state: StoreState; extra: StoreExtra; rejectValue: SendError }
>(
  'chats/send',
  async (arg, api) => {
    const current = api.getState().session.current
    const fail = (error: string) =>
      api.rejectWithValue({ status: 'failed', error })
    if (!current) return fail('Сначала выполните вход.')
    const limit = MESSENGERS[current.messenger].maxMessageLength
    if (!arg.text.trim()) return fail('Введите текст сообщения.')
    if (arg.text.length > limit)
      return fail(`Сообщение длиннее допустимых ${limit} символов.`)
    if (!api.getState().chats.byId[arg.chatId])
      return fail('Сначала откройте чат.')
    const key = arg.retryKey ?? api.requestId
    let submitted = false
    try {
      const signal = AbortSignal.any([api.signal, api.extra.getSignal()])
      const client = api.extra.createClient(current.credentials)
      if (signal.aborted) return fail('Запрос отменён до отправки.')
      api.dispatch(
        outgoingStarted({
          sessionId: arg.sessionId,
          retryKey: arg.retryKey,
          message: {
            key,
            chatId: arg.chatId,
            text: arg.text,
            direction: 'out',
            timestamp: Date.now() / 1000,
            status: 'sending',
          },
        }),
      )
      submitted = true
      const result = await client.sendMessage(arg.chatId, arg.text, signal)
      if (
        !result ||
        typeof result.idMessage !== 'string' ||
        !result.idMessage
      ) {
        return api.rejectWithValue({
          status: 'unknown',
          error:
            'GREEN-API не подтвердил отправку. Повтор может создать дубликат.',
        })
      }
      return { chatId: arg.chatId, key, idMessage: result.idMessage }
    } catch (error) {
      const uncertain =
        submitted &&
        (!(error instanceof GreenApiError) ||
          ['network', 'aborted'].includes(error.kind))
      return api.rejectWithValue({
        status: uncertain ? 'unknown' : 'failed',
        error: uncertain
          ? 'Не удалось подтвердить отправку. Ручной повтор может создать дубликат.'
          : describeError(error),
      })
    }
  },
  currentSessionOnly,
)

export const retrySend = createOperation<void, SessionScope & { key: string }>(
  'chats/retry',
  async (arg, api) => {
    const message = Object.values(api.getState().chats.messagesByChat)
      .flat()
      .find((m) => m.key === arg.key)
    if (
      !message ||
      message.direction !== 'out' ||
      !['failed', 'unknown'].includes(message.status)
    ) {
      return api.rejectWithValue('Это сообщение нельзя отправить повторно.')
    }
    const result = await api.dispatch(
      sendMessage({
        sessionId: arg.sessionId,
        chatId: message.chatId,
        text: message.text,
        retryKey: message.key,
      }),
    )
    if (sendMessage.rejected.match(result))
      return api.rejectWithValue(
        result.payload?.error ?? 'Не удалось повторить отправку.',
      )
  },
  currentSessionOnly,
)
