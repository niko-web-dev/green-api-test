import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { Credentials } from '../api/types'
import type { MessengerId } from '../messengers'
import type { SessionScope } from './types'
import type { loginOperation } from './thunks'

export interface Session {
  messenger: MessengerId
  credentials: Credentials
}

export interface SessionState {
  current: Session | null
  sessionId: number
  connection: 'idle' | 'online' | 'reconnecting' | 'error'
  error: string | null
  warning: string | null
  loginRequestId: string | null
}

const initialState: SessionState = {
  current: null,
  sessionId: 0,
  connection: 'idle',
  error: null,
  warning: null,
  loginRequestId: null,
}

export const SESSION_STORAGE_KEY = 'green-api-session'

export function saveSession(session: Session | null): void {
  try {
    if (session)
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Запрет хранилища не должен мешать обмену сообщениями в текущей вкладке.
  }
}

export function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (
      !value ||
      typeof value !== 'object' ||
      !('messenger' in value) ||
      !['max', 'telegram', 'whatsapp'].includes(String(value.messenger)) ||
      !('credentials' in value)
    )
      return null
    const c = value.credentials
    if (
      !c ||
      typeof c !== 'object' ||
      !('apiUrl' in c) ||
      typeof c.apiUrl !== 'string' ||
      !c.apiUrl ||
      !('idInstance' in c) ||
      typeof c.idInstance !== 'string' ||
      !c.idInstance ||
      !('apiTokenInstance' in c) ||
      typeof c.apiTokenInstance !== 'string' ||
      !c.apiTokenInstance
    )
      return null
    return value as Session
  } catch {
    return null
  }
}

const slice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    sessionStarted: (state, action: PayloadAction<Session>) => ({
      ...initialState,
      current: action.payload,
      sessionId: state.sessionId + 1,
    }),
    loggedOut: (state) => ({
      ...initialState,
      // Счётчик нельзя обнулять: иначе поздний ответ до выхода совпадёт с новой сессией.
      sessionId: state.sessionId + 1,
    }),
    connectionChanged(
      state,
      action: PayloadAction<
        SessionScope & {
          connection: SessionState['connection']
          error?: string | null
        }
      >,
    ) {
      if (action.payload.sessionId !== state.sessionId) return
      state.connection = action.payload.connection
      state.error = action.payload.error ?? null
    },
    warningChanged(
      state,
      action: PayloadAction<SessionScope & { warning: string | null }>,
    ) {
      if (action.payload.sessionId === state.sessionId)
        state.warning = action.payload.warning
    },
  },
  extraReducers: (builder) => {
    builder.addMatcher(
      (action): action is ReturnType<typeof loginOperation.pending> =>
        action.type === 'session/login/pending',
      (state, action) => {
        if (action.meta.arg.sessionId !== state.sessionId) return
        state.loginRequestId = action.meta.requestId
        state.error = null
      },
    )
    builder.addMatcher(
      (action): action is ReturnType<typeof loginOperation.rejected> =>
        action.type === 'session/login/rejected',
      (state, action) => {
        if (action.meta.arg.sessionId !== state.sessionId) return
        if (state.loginRequestId !== action.meta.requestId) return
        state.loginRequestId = null
        state.error = action.payload ?? 'Не удалось выполнить вход.'
      },
    )
  },
})

export const { sessionStarted, loggedOut, connectionChanged, warningChanged } =
  slice.actions
export default slice.reducer
