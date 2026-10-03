import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import { GreenApiError } from '../api/greenApiClient'
import { MESSENGERS } from '../messengers'
import { parseNotification } from '../notifications'
import { runNotificationLoop } from '../notificationLoop'
import { incomingReceived } from './chatsSlice'
import {
  sessionStarted,
  loggedOut,
  saveSession,
  connectionChanged,
  warningChanged,
} from './sessionSlice'
import type { StoreExtra, StoreState } from './types'

export function createPollingListener(extra: StoreExtra) {
  const listener = createListenerMiddleware<StoreState>()
  listener.startListening({
    // Отмена действует на экземпляры одного листенера, поэтому выход и вход объединены.
    matcher: isAnyOf(sessionStarted, loggedOut),
    effect: async (action, api) => {
      api.cancelActiveListeners()
      const { current, sessionId } = api.getState().session
      saveSession(current)
      if (loggedOut.match(action) || !current) return
      const signal = AbortSignal.any([api.signal, extra.getSignal()])
      const active = () =>
        !signal.aborted && api.getState().session.sessionId === sessionId
      try {
        const client = extra.createClient(current.credentials)
        await runNotificationLoop(
          client,
          {
            onNotification(body) {
              if (!active()) return
              const typeInstance = body.instanceData?.typeInstance
              if (
                typeInstance &&
                typeInstance !== MESSENGERS[current.messenger].typeInstance
              ) {
                api.dispatch(
                  warningChanged({
                    sessionId,
                    warning:
                      'Тип инстанса не совпадает с выбранным мессенджером. Проверьте учётные данные.',
                  }),
                )
              }
              const parsed = parseNotification(body)
              if (parsed)
                api.dispatch(incomingReceived({ ...parsed, sessionId }))
            },
            onStatus(status, error) {
              if (!active()) return
              api.dispatch(
                connectionChanged({
                  sessionId,
                  connection: status === 'stopped' ? 'error' : status,
                  error: error ? new GreenApiError(error.kind).message : null,
                }),
              )
            },
          },
          signal,
        )
      } catch {
        if (active())
          api.dispatch(
            connectionChanged({
              sessionId,
              connection: 'error',
              error: 'Не удалось запустить получение уведомлений.',
            }),
          )
      }
    },
  })
  return listener
}
