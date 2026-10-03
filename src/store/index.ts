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

function reducer(
  state: StoreState | undefined,
  action: UnknownAction,
): StoreState {
  if (
    state &&
    (action.type.startsWith('session/') || action.type.startsWith('chats/'))
  ) {
    const meta = action.meta
    if (meta && typeof meta === 'object' && 'arg' in meta) {
      const arg = meta.arg
      // Все async-ответы проверяются до слайсов: отмена запроса сама по себе не исключает поздний ответ.
      if (
        arg &&
        typeof arg === 'object' &&
        'sessionId' in arg &&
        arg.sessionId !== state.session.sessionId
      )
        return state
    }
  }
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
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
