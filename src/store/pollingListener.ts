import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import { describeError } from '../api/greenApiClient'
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
      try {
        const client = extra.createClient(current.credentials)
        await runNotificationLoop(
          client,
          {
            onNotification(body) {
              const parsed = parseNotification(body)
              if (!parsed) return
              if (
                parsed.typeInstance !==
                  MESSENGERS[current.messenger].typeInstance &&
                !api.getState().session.warning
              ) {
                api.dispatch(
                  warningChanged({
                    sessionId,
                    warning:
                      'Тип инстанса не совпадает с выбранным мессенджером. Проверьте учётные данные.',
                  }),
                )
              }
              api.dispatch(incomingReceived({ ...parsed, sessionId }))
            },
            onStatus(status, error) {
              api.dispatch(
                connectionChanged({
                  sessionId,
                  connection: status === 'stopped' ? 'error' : status,
                  error: error ? describeError(error) : null,
                }),
              )
            },
          },
          api.signal,
        )
      } catch {
        if (!api.signal.aborted)
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
