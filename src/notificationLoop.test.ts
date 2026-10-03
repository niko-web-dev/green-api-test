import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GreenApiError } from './api/greenApiClient'
import { createFakeClient } from './test/fakeClient'
import type { ReceivedNotification } from './api/types'
import { runNotificationLoop } from './notificationLoop'

function notification(receiptId = 1): ReceivedNotification {
  return { receiptId, body: { typeWebhook: 'stateInstanceChanged' } }
}

function setup() {
  const controller = new AbortController()
  const client = createFakeClient()
  const handlers = { onNotification: vi.fn(), onStatus: vi.fn() }
  return { controller, client, handlers, signal: controller.signal }
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Цикл получения уведомлений', () => {
  it('обрабатывает событие до последовательного delete', async () => {
    const { client, handlers, controller, signal } = setup()
    const order: string[] = []
    const event = notification()
    let finishDelete!: () => void
    client.receiveNotification.mockImplementationOnce(async () => {
      order.push('receive')
      return event
    })
    handlers.onNotification.mockImplementation(() => order.push('handler'))
    client.deleteNotification.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          order.push('delete')
          finishDelete = resolve
        }),
    )
    const loop = runNotificationLoop(client, handlers, signal)
    expect(handlers.onStatus).not.toHaveBeenCalled()
    await flush()
    expect(order).toEqual(['receive', 'handler', 'delete'])
    expect(handlers.onNotification).toHaveBeenCalledWith(event.body)
    expect(client.receiveNotification).toHaveBeenCalledExactlyOnceWith(
      5,
      signal,
    )
    expect(client.deleteNotification).toHaveBeenCalledWith(1, signal)
    finishDelete()
    await flush()
    expect(client.receiveNotification).toHaveBeenCalledTimes(2)
    controller.abort()
    await loop
  })

  it('после null продолжает длинный опрос', async () => {
    const { client, handlers, controller, signal } = setup()
    client.receiveNotification
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const loop = runNotificationLoop(client, handlers, signal)
    await flush()
    expect(client.receiveNotification).toHaveBeenCalledTimes(3)
    expect(client.receiveNotification).toHaveBeenLastCalledWith(20, signal)
    expect(client.receiveNotification).toHaveBeenNthCalledWith(1, 5, signal)
    expect(handlers.onStatus).toHaveBeenCalledExactlyOnceWith('online')
    expect(handlers.onNotification).not.toHaveBeenCalled()
    expect(client.deleteNotification).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    controller.abort()
    await loop
  })

  it.each(['успех', 'ошибка'] as const)(
    'повторяет обработку после delete: %s',
    async (result) => {
      const { client, handlers, controller, signal } = setup()
      client.receiveNotification
        .mockResolvedValueOnce(notification())
        .mockResolvedValueOnce(notification())
      if (result === 'ошибка')
        client.deleteNotification.mockRejectedValueOnce(
          new GreenApiError('network'),
        )
      const loop = runNotificationLoop(client, handlers, signal)
      await flush()
      if (result !== 'успех') await vi.advanceTimersByTimeAsync(1000)
      expect(handlers.onNotification).toHaveBeenCalledTimes(2)
      expect(client.deleteNotification.mock.calls).toEqual([
        [1, signal],
        [1, signal],
      ])
      controller.abort()
      await loop
    },
  )

  it('ошибка обработчика не блокирует очередь', async () => {
    const { client, handlers, controller, signal } = setup()
    client.receiveNotification
      .mockResolvedValueOnce(notification(1))
      .mockResolvedValueOnce(notification(1))
      .mockResolvedValueOnce(notification(2))
    handlers.onNotification.mockImplementationOnce(() => {
      throw new Error('Ошибка обработки')
    })
    const loop = runNotificationLoop(client, handlers, signal)
    await flush()
    expect(handlers.onNotification).toHaveBeenCalledTimes(3)
    expect(client.deleteNotification.mock.calls.map(([id]) => id)).toEqual([
      1, 1, 2,
    ])
    expect(handlers.onStatus).toHaveBeenCalledExactlyOnceWith('online')
    controller.abort()
    await loop
  })

  it.each(['network', 'notReady'] as const)(
    'наращивает и сбрасывает паузу: %s',
    async (kind) => {
      const { client, handlers, controller, signal } = setup()
      const error = new GreenApiError(kind)
      for (let i = 0; i < 7; i++)
        client.receiveNotification.mockRejectedValueOnce(error)
      client.receiveNotification
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(null)
      const loop = runNotificationLoop(client, handlers, signal)
      await flush()
      for (const [index, delay] of [
        1000, 2000, 4000, 8000, 16000, 30000, 30000,
      ].entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1)
        expect(client.receiveNotification).toHaveBeenCalledTimes(index + 1)
        await vi.advanceTimersByTimeAsync(1)
      }
      expect(handlers.onStatus.mock.calls).toEqual([
        ...Array.from({ length: 7 }, () => ['reconnecting', error]),
        ['online'],
        ['reconnecting', error],
      ])
      await vi.advanceTimersByTimeAsync(999)
      expect(client.receiveNotification).toHaveBeenCalledTimes(9)
      await vi.advanceTimersByTimeAsync(1)
      expect(client.receiveNotification).toHaveBeenCalledTimes(11)
      expect(client.receiveNotification).toHaveBeenNthCalledWith(10, 5, signal)
      expect(client.receiveNotification).toHaveBeenLastCalledWith(20, signal)
      expect(handlers.onStatus).toHaveBeenLastCalledWith('online')
      controller.abort()
      await loop
    },
  )

  it.each(['auth', 'webhookSet', 'quota', 'badRequest'] as const)(
    'останавливается при %s',
    async (kind) => {
      const { client, handlers, signal } = setup()
      const error = new GreenApiError(kind)
      client.receiveNotification.mockRejectedValueOnce(error)
      await runNotificationLoop(client, handlers, signal)
      expect(handlers.onStatus).toHaveBeenLastCalledWith('stopped', error)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.receiveNotification).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('заранее отменённый цикл не запускается', async () => {
    const { client, handlers, controller, signal } = setup()
    controller.abort()
    await runNotificationLoop(client, handlers, signal)
    expect(client.receiveNotification).not.toHaveBeenCalled()
    expect(handlers.onStatus).not.toHaveBeenCalled()
  })

  it('отмена receive завершает цикл', async () => {
    const { client, handlers, controller, signal } = setup()
    const loop = runNotificationLoop(client, handlers, signal)
    controller.abort()
    await loop
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(handlers.onStatus).not.toHaveBeenCalled()
  })

  it('отмена очищает паузу и слушатель', async () => {
    const { client, handlers, controller, signal } = setup()
    const removeListener = vi.spyOn(signal, 'removeEventListener')
    const error = new GreenApiError('network')
    client.receiveNotification.mockRejectedValueOnce(error)
    const loop = runNotificationLoop(client, handlers, signal)
    await flush()
    expect(vi.getTimerCount()).toBe(1)
    controller.abort()
    await loop
    expect(vi.getTimerCount()).toBe(0)
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(handlers.onStatus).toHaveBeenCalledExactlyOnceWith(
      'reconnecting',
      error,
    )
  })

  it('aborted без сигнала вызывает переподключение', async () => {
    const { client, handlers, controller, signal } = setup()
    client.receiveNotification.mockRejectedValueOnce(
      new GreenApiError('aborted'),
    )
    const loop = runNotificationLoop(client, handlers, signal)
    await flush()
    expect(handlers.onStatus).toHaveBeenCalledWith(
      'reconnecting',
      expect.objectContaining({ kind: 'network' }),
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(client.receiveNotification).toHaveBeenCalledTimes(2)
    expect(client.receiveNotification).toHaveBeenLastCalledWith(5, signal)
    controller.abort()
    await loop
    expect(vi.getTimerCount()).toBe(0)
  })

  it('отмена delete завершает цикл', async () => {
    const { client, handlers, controller, signal } = setup()
    client.receiveNotification.mockResolvedValueOnce(notification())
    client.deleteNotification.mockImplementationOnce(
      (_id, deleteSignal) =>
        new Promise((_resolve, reject) => {
          deleteSignal?.addEventListener(
            'abort',
            () => reject(new GreenApiError('aborted')),
            { once: true },
          )
        }),
    )
    const loop = runNotificationLoop(client, handlers, signal)
    await flush()
    controller.abort()
    await loop
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(client.deleteNotification).toHaveBeenCalledExactlyOnceWith(1, signal)
    expect(handlers.onStatus).toHaveBeenCalledExactlyOnceWith('online')
  })

  it('отбрасывает поздний ответ receive после отмены', async () => {
    const { client, handlers, controller, signal } = setup()
    let resolve!: (event: ReceivedNotification) => void
    client.receiveNotification.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const loop = runNotificationLoop(client, handlers, signal)
    controller.abort()
    resolve(notification())
    await loop
    expect(handlers.onNotification).not.toHaveBeenCalled()
    expect(handlers.onStatus).not.toHaveBeenCalled()
    expect(client.deleteNotification).not.toHaveBeenCalled()
  })

  it('отмена обработчика предотвращает delete', async () => {
    const { client, handlers, controller, signal } = setup()
    client.receiveNotification.mockResolvedValueOnce(notification())
    handlers.onNotification.mockImplementation(() => controller.abort())
    await runNotificationLoop(client, handlers, signal)
    expect(client.deleteNotification).not.toHaveBeenCalled()
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
  })

  it('отмена статуса предотвращает обработку события', async () => {
    const { client, handlers, controller, signal } = setup()
    client.receiveNotification.mockResolvedValueOnce(notification())
    handlers.onStatus.mockImplementation(() => controller.abort())
    await runNotificationLoop(client, handlers, signal)
    expect(handlers.onNotification).not.toHaveBeenCalled()
    expect(client.deleteNotification).not.toHaveBeenCalled()
  })
})
