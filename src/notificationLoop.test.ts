import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GreenApiError } from './api/greenApiClient'
import type { GreenApiClient } from './api/greenApiClient'
import type { ReceivedNotification } from './api/types'
import { runNotificationLoop } from './notificationLoop'

function notification(receiptId = 1): ReceivedNotification {
  return { receiptId, body: { typeWebhook: 'stateInstanceChanged' } }
}

function setup() {
  const controller = new AbortController()
  const client = {
    getStateInstance: vi.fn<GreenApiClient['getStateInstance']>(),
    checkAccount: vi.fn<GreenApiClient['checkAccount']>(),
    checkWhatsapp: vi.fn<GreenApiClient['checkWhatsapp']>(),
    sendMessage: vi.fn<GreenApiClient['sendMessage']>(),
    receiveNotification: vi.fn<GreenApiClient['receiveNotification']>(
      (_timeout, signal) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new GreenApiError('aborted'))
            return
          }
          signal?.addEventListener(
            'abort',
            () => reject(new GreenApiError('aborted')),
            { once: true },
          )
        }),
    ),
    deleteNotification: vi
      .fn<GreenApiClient['deleteNotification']>()
      .mockResolvedValue(true),
  } satisfies GreenApiClient
  const handlers = { onNotification: vi.fn(), onStatus: vi.fn() }
  return { controller, client, handlers, signal: controller.signal }
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Цикл получения уведомлений', () => {
  it('обрабатывает даже служебное событие до подтверждения, без параллельных запросов', async () => {
    const { client, handlers, controller, signal } = setup()
    const order: string[] = []
    const event = notification()
    let finishDelete!: (result: boolean) => void
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
      20,
      signal,
    )
    expect(client.deleteNotification).toHaveBeenCalledWith(1, signal)
    finishDelete(true)
    await flush()
    expect(client.receiveNotification).toHaveBeenCalledTimes(2)
    controller.abort()
    await loop
  })

  it('сразу повторяет запрос после null и сообщает online только один раз', async () => {
    const { client, handlers, controller, signal } = setup()
    client.receiveNotification
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const loop = runNotificationLoop(client, handlers, signal, {
      receiveTimeoutSec: 35,
    })
    await flush()
    expect(client.receiveNotification).toHaveBeenCalledTimes(3)
    expect(client.receiveNotification).toHaveBeenLastCalledWith(35, signal)
    expect(handlers.onStatus).toHaveBeenCalledExactlyOnceWith('online')
    expect(handlers.onNotification).not.toHaveBeenCalled()
    expect(client.deleteNotification).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    controller.abort()
    await loop
  })

  it.each(['успех', 'ошибка', 'false'] as const)(
    'повторяет подтверждение, но не обработку receiptId после результата delete: %s',
    async (result) => {
      const { client, handlers, controller, signal } = setup()
      client.receiveNotification
        .mockResolvedValueOnce(notification())
        .mockResolvedValueOnce(notification())
      if (result === 'ошибка')
        client.deleteNotification.mockRejectedValueOnce(
          new GreenApiError('network'),
        )
      if (result === 'false')
        client.deleteNotification.mockResolvedValueOnce(false)
      const loop = runNotificationLoop(client, handlers, signal)
      await flush()
      if (result !== 'успех') await vi.advanceTimersByTimeAsync(1000)
      expect(handlers.onNotification).toHaveBeenCalledTimes(1)
      expect(client.deleteNotification.mock.calls).toEqual([
        [1, signal],
        [1, signal],
      ])
      controller.abort()
      await loop
    },
  )

  it('подтверждает событие при исключении обработчика и продолжает очередь', async () => {
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
    expect(handlers.onNotification).toHaveBeenCalledTimes(2)
    expect(client.deleteNotification.mock.calls.map(([id]) => id)).toEqual([
      1, 1, 2,
    ])
    expect(handlers.onStatus).toHaveBeenCalledExactlyOnceWith('online')
    controller.abort()
    await loop
  })

  it('сохраняет ровно последние 100 разных receiptId, повторы не вытесняют старые', async () => {
    const { client, handlers, controller, signal } = setup()
    for (let id = 1; id <= 100; id++)
      client.receiveNotification.mockResolvedValueOnce(notification(id))
    client.receiveNotification
      .mockResolvedValueOnce(notification(1))
      .mockResolvedValueOnce(notification(101))
      .mockResolvedValueOnce(notification(2))
      .mockResolvedValueOnce(notification(1))
    const loop = runNotificationLoop(client, handlers, signal)
    await flush()
    expect(handlers.onNotification).toHaveBeenCalledTimes(102)
    expect(client.deleteNotification).toHaveBeenCalledTimes(104)
    controller.abort()
    await loop
  })

  it.each(['network', 'server', 'rateLimit'] as const)(
    'увеличивает паузу до 30 секунд при %s, восстанавливается и сбрасывает паузу',
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
      expect(handlers.onStatus).toHaveBeenLastCalledWith('online')
      controller.abort()
      await loop
    },
  )

  it('учитывает пользовательский предел паузы, в том числе меньше секунды', async () => {
    const { client, handlers, controller, signal } = setup()
    client.receiveNotification
      .mockRejectedValueOnce(new GreenApiError('network'))
      .mockRejectedValueOnce(new GreenApiError('network'))
    const loop = runNotificationLoop(client, handlers, signal, {
      maxBackoffMs: 250,
    })
    await flush()
    await vi.advanceTimersByTimeAsync(249)
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(client.receiveNotification).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(client.receiveNotification).toHaveBeenCalledTimes(3)
    controller.abort()
    await loop
  })

  it.each(['auth', 'webhookSet', 'quota', 'badRequest'] as const)(
    'останавливается при %s как на receive, так и на delete',
    async (kind) => {
      for (const method of [
        'receiveNotification',
        'deleteNotification',
      ] as const) {
        const { client, handlers, signal } = setup()
        const error = new GreenApiError(kind)
        if (method === 'deleteNotification')
          client.receiveNotification.mockResolvedValueOnce(notification())
        client[method].mockRejectedValueOnce(error)
        await runNotificationLoop(client, handlers, signal)
        expect(handlers.onStatus).toHaveBeenLastCalledWith('stopped', error)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(client.receiveNotification).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
      }
    },
  )

  it('выходит при заранее отменённом сигнале без запросов и статусов', async () => {
    const { client, handlers, controller, signal } = setup()
    controller.abort()
    await runNotificationLoop(client, handlers, signal)
    expect(client.receiveNotification).not.toHaveBeenCalled()
    expect(handlers.onStatus).not.toHaveBeenCalled()
  })

  it('отменяет ожидающий receive без ошибки статуса и новых запросов', async () => {
    const { client, handlers, controller, signal } = setup()
    const loop = runNotificationLoop(client, handlers, signal)
    controller.abort()
    await loop
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(handlers.onStatus).not.toHaveBeenCalled()
  })

  it('немедленно прерывает паузу и удаляет таймер и слушатель отмены', async () => {
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

  it.each(['receiveNotification', 'deleteNotification'] as const)(
    'не считает ошибку aborted на %s аварией даже без отмены сигнала',
    async (method) => {
      const { client, handlers, signal } = setup()
      if (method === 'deleteNotification')
        client.receiveNotification.mockResolvedValueOnce(notification())
      client[method].mockRejectedValueOnce(new GreenApiError('aborted'))
      await runNotificationLoop(client, handlers, signal)
      expect(handlers.onStatus.mock.calls).toEqual(
        method === 'deleteNotification' ? [['online']] : [],
      )
      expect(client.receiveNotification).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('отменяет ожидающий delete без повторного запроса и ошибки статуса', async () => {
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

  it('не разделяет receiptId между одновременно работающими циклами', async () => {
    const first = setup()
    const second = setup()
    first.client.receiveNotification.mockResolvedValueOnce(notification())
    second.client.receiveNotification.mockResolvedValueOnce(notification())
    const firstLoop = runNotificationLoop(
      first.client,
      first.handlers,
      first.signal,
    )
    const secondLoop = runNotificationLoop(
      second.client,
      second.handlers,
      second.signal,
    )
    await flush()
    expect(first.handlers.onNotification).toHaveBeenCalledTimes(1)
    expect(second.handlers.onNotification).toHaveBeenCalledTimes(1)
    first.controller.abort()
    await firstLoop
    expect(second.signal.aborted).toBe(false)
    second.controller.abort()
    await secondLoop
  })

  it('ограничивает экспоненциальную паузу нестепенным пределом и очищает слушатель после таймера', async () => {
    const { client, handlers, controller, signal } = setup()
    const removeListener = vi.spyOn(signal, 'removeEventListener')
    for (let i = 0; i < 4; i++)
      client.receiveNotification.mockRejectedValueOnce(
        new GreenApiError('network'),
      )
    const loop = runNotificationLoop(client, handlers, signal, {
      maxBackoffMs: 2500,
    })
    await flush()
    for (const [index, delay] of [1000, 2000, 2500, 2500].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(client.receiveNotification).toHaveBeenCalledTimes(index + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(removeListener).toHaveBeenCalledTimes(index + 1)
    }
    expect(vi.getTimerCount()).toBe(0)
    controller.abort()
    await loop
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

  it('не подтверждает событие, если обработчик отменил сигнал', async () => {
    const { client, handlers, controller, signal } = setup()
    client.receiveNotification.mockResolvedValueOnce(notification())
    handlers.onNotification.mockImplementation(() => controller.abort())
    await runNotificationLoop(client, handlers, signal)
    expect(client.deleteNotification).not.toHaveBeenCalled()
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
  })

  it('отмена одного запуска не затрагивает обработку, дедупликацию и паузу другого', async () => {
    const first = setup()
    const second = setup()
    first.client.receiveNotification.mockRejectedValueOnce(
      new GreenApiError('network'),
    )
    second.client.receiveNotification
      .mockResolvedValueOnce(notification())
      .mockRejectedValueOnce(new GreenApiError('server'))
      .mockResolvedValueOnce(notification())
    const firstLoop = runNotificationLoop(
      first.client,
      first.handlers,
      first.signal,
    )
    const secondLoop = runNotificationLoop(
      second.client,
      second.handlers,
      second.signal,
    )
    await flush()
    first.controller.abort()
    await firstLoop
    await vi.advanceTimersByTimeAsync(1000)
    expect(first.client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(second.client.deleteNotification).toHaveBeenCalledTimes(2)
    expect(second.handlers.onNotification).toHaveBeenCalledTimes(1)
    second.controller.abort()
    await secondLoop
    const third = setup()
    third.client.receiveNotification.mockResolvedValueOnce(notification())
    const thirdLoop = runNotificationLoop(
      third.client,
      third.handlers,
      third.signal,
    )
    await flush()
    expect(third.handlers.onNotification).toHaveBeenCalledTimes(1)
    third.controller.abort()
    await thirdLoop
  })
})
