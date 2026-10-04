import { combineReducers, configureStore, isAction } from '@reduxjs/toolkit'
import type { Middleware, UnknownAction } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import { createGreenApiClient } from '../api/greenApiClient'
import sessionReducer, { sessionStarted, loggedOut } from './sessionSlice'
import chatsReducer from './chatsSlice'
import { createPollingListener } from './pollingListener'
import type { StoreDependencies, StoreExtra, StoreState } from './types'

const combinedReducer = combineReducers({
  session: sessionReducer,
  chats: chatsReducer,
})

function sessionIdOf(action: UnknownAction): unknown {
  const meta = action.meta as { arg?: { sessionId?: unknown } } | undefined
  const payload = action.payload as { sessionId?: unknown } | null | undefined
  return meta?.arg?.sessionId ?? payload?.sessionId
}

function reducer(
  state: StoreState | undefined,
  action: UnknownAction,
): StoreState {
  const id = sessionIdOf(action)
  // Единственная защита от поздних ответов: действие чужой сессии не доходит до слайсов.
  // Отмена запроса её не заменяет — ответ может прийти до обработки abort.
  if (state && typeof id === 'number' && id !== state.session.sessionId)
    return state
  return combinedReducer(state, action)
}

export function makeStore(
  dependencies: StoreDependencies = { createClient: createGreenApiClient },
) {
  let controller = new AbortController()
  const extra: StoreExtra = {
    ...dependencies,
    getSignal: () => controller.signal,
  }
  const lifecycle: Middleware = () => (next) => (action) => {
    if (
      isAction(action) &&
      (sessionStarted.match(action) || loggedOut.match(action))
    ) {
      controller.abort()
      controller = new AbortController()
    }
    return next(action)
  }
  const listener = createPollingListener(extra)
  return configureStore({
    reducer,
    // Credentials не должны попадать в журнал Redux DevTools.
    devTools: false,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ thunk: { extraArgument: extra } }).prepend(
        lifecycle,
        listener.middleware,
      ),
  })
}

export const store = makeStore()
export type AppStore = ReturnType<typeof makeStore>
export type RootState = StoreState
export type AppDispatch = typeof store.dispatch
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
