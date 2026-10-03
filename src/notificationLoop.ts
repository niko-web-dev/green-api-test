import { GreenApiError } from './api/greenApiClient'
import type { GreenApiClient, GreenApiErrorKind } from './api/greenApiClient'

export type LoopStatus = 'online' | 'reconnecting' | 'stopped'

export interface LoopHandlers {
  onNotification(body: Record<string, unknown>): void
  onStatus(status: LoopStatus, error?: GreenApiError): void
}

const FIRST_RECEIVE_TIMEOUT_SEC = 5
const RECEIVE_TIMEOUT_SEC = 20
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000
// Повтор не поможет: нужны правка учётных данных, настроек инстанса или тарифа.
const STOP_KINDS = new Set<GreenApiErrorKind>([
  'auth',
  'webhookSet',
  'quota',
  'badRequest',
])

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export async function runNotificationLoop(
  client: GreenApiClient,
  handlers: LoopHandlers,
  signal: AbortSignal,
): Promise<void> {
  let backoffMs = INITIAL_BACKOFF_MS
  let status: LoopStatus | undefined

  while (!signal.aborted) {
    try {
      // Короткий первый запрос подтверждает online за 5 с даже на пустой очереди.
      const timeoutSec =
        status === 'online' ? RECEIVE_TIMEOUT_SEC : FIRST_RECEIVE_TIMEOUT_SEC
      const notification = await client.receiveNotification(timeoutSec, signal)
      if (signal.aborted) return
      if (status !== 'online') {
        status = 'online'
        handlers.onStatus(status)
      }
      backoffMs = INITIAL_BACKOFF_MS
      if (signal.aborted) return
      if (notification === null) continue

      const { receiptId, body } = notification
      // Повтор после неудачного delete допустим: дубли отсекает стор по idMessage.
      // Подтверждаем и нерелевантные уведомления, иначе очередь встанет на них.
      try {
        handlers.onNotification(body)
      } catch {
        // Ошибка обработчика не должна блокировать FIFO-очередь: подтверждаем и такое событие.
      }
      if (signal.aborted) return
      await client.deleteNotification(receiptId, signal)
      if (signal.aborted) return
    } catch (error) {
      if (signal.aborted) return
      // Отмена без нашего сигнала — обрыв транспорта, а не выход из цикла.
      const err =
        error instanceof GreenApiError && error.kind !== 'aborted'
          ? error
          : new GreenApiError('network')
      if (STOP_KINDS.has(err.kind)) {
        handlers.onStatus('stopped', err)
        return
      }
      status = 'reconnecting'
      handlers.onStatus(status, err)
      await pause(backoffMs, signal)
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
    }
  }
}
