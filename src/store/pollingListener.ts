import { createListenerMiddleware, isAnyOf } from '@reduxjs/toolkit'
import { describeError } from '../api/greenApiClient'
import { MESSENGERS } from '../messengers'
import { parseNotification } from '../notifications'
import { runNotificationLoop } from '../notificationLoop'
import { incomingReceived, messageStatusUpdated } from './chatsSlice'
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
        const run = async () => {
          if (api.signal.aborted) return
          api.dispatch(warningChanged({ sessionId, warning: null }))
          api.dispatch(connectionChanged({ sessionId, connection: 'idle' }))
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
                if ('status' in parsed)
                  api.dispatch(messageStatusUpdated({ ...parsed, sessionId }))
                else api.dispatch(incomingReceived({ ...parsed, sessionId }))
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
        }
        if (!navigator.locks) {
          // Старые браузеры и небезопасные контексты работают без защиты между вкладками.
          await run()
          return
        }
        const name = `green-api:${current.credentials.idInstance}`
        let acquired = false
        // ifAvailable несовместим с signal: отмену проверяем внутри пробного захвата.
        await navigator.locks.request(
          name,
          { ifAvailable: true },
          async (lock) => {
            if (!lock || api.signal.aborted) return
            acquired = true
            await run()
          },
        )
        if (acquired || api.signal.aborted) return
        api.dispatch(connectionChanged({ sessionId, connection: 'standby' }))
        api.dispatch(
          warningChanged({
            sessionId,
            warning:
              'Инстанс открыт в другой вкладке: новые сообщения приходят туда',
          }),
        )
        await navigator.locks.request(name, { signal: api.signal }, run)
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
