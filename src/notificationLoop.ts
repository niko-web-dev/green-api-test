import { GreenApiError } from './api/greenApiClient'
import type { GreenApiClient } from './api/greenApiClient'
import type { NotificationBody } from './api/types'

export type LoopStatus = 'online' | 'reconnecting' | 'stopped'

export interface LoopHandlers {
  onNotification(body: NotificationBody): void
  onStatus(status: LoopStatus, error?: GreenApiError): void
}

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
  options: { receiveTimeoutSec?: number; maxBackoffMs?: number } = {},
): Promise<void> {
  const timeoutSec = options.receiveTimeoutSec ?? 20
  const maxBackoffMs = options.maxBackoffMs ?? 30_000
  const receipts = new Set<number>()
  let backoffMs = Math.min(1000, maxBackoffMs)
  let status: LoopStatus | undefined

  while (!signal.aborted) {
    try {
      const notification = await client.receiveNotification(timeoutSec, signal)
      if (signal.aborted) return
      if (status !== 'online') {
        status = 'online'
        handlers.onStatus(status)
      }
      backoffMs = Math.min(1000, maxBackoffMs)
      if (signal.aborted) return
      if (notification === null) continue

      const { receiptId, body } = notification
      if (!receipts.has(receiptId)) {
        receipts.add(receiptId)
        if (receipts.size > 100) {
          const oldest = receipts.values().next().value
          if (oldest !== undefined) receipts.delete(oldest)
        }
        try {
          handlers.onNotification(body)
        } catch {
          // Ошибка обработчика не должна навсегда блокировать FIFO-очередь.
          // Подтверждаем даже такое событие: ценой его потери сохраняем доставку следующих.
        }
      }
      if (signal.aborted) return
      const deleted = await client.deleteNotification(receiptId, signal)
      if (signal.aborted) return
      if (!deleted) throw new GreenApiError('server')
    } catch (error) {
      if (signal.aborted) return
      const err =
        error instanceof GreenApiError ? error : new GreenApiError('network')
      if (err.kind === 'aborted') return
      if (
        err.kind === 'auth' ||
        err.kind === 'webhookSet' ||
        err.kind === 'quota' ||
        err.kind === 'badRequest'
      ) {
        handlers.onStatus('stopped', err)
        return
      }
      status = 'reconnecting'
      handlers.onStatus(status, err)
      await pause(backoffMs, signal)
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs)
    }
  }
}
