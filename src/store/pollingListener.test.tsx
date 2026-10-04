import { act, cleanup, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGreenApiError } from '../api/errors'
import { createFakeClient } from '../api/fakeClient'
import ChatLayout from '../components/ChatLayout'
import { makeStore } from './index'
import type { LockRequest } from './pollingListener.test.types'
import { loggedOut, sessionStarted } from './sessionSlice'
import type { AppStore, Session } from './types'

const warning = 'Инстанс открыт в другой вкладке: новые сообщения приходят туда'

function fakeLocks() {
  const held = new Set<string>()
  const queues = new Map<string, LockRequest[]>()

  function grant(name: string) {
    if (held.has(name)) return
    const next = queues.get(name)?.shift()
    if (!next) return
    next.signal?.removeEventListener('abort', next.abort)
    held.add(name)
    // Выдача замка асинхронна; отмена после выдачи не освобождает его сама.
    void Promise.resolve()
      .then(() => next.callback({ name, mode: 'exclusive' } as Lock))
      .then(next.resolve, next.reject)
      .finally(() => {
        held.delete(name)
        grant(name)
      })
  }

  const request = vi.fn(
    (
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => Promise<void>,
    ): Promise<void> => {
      if (options.ifAvailable && options.signal)
        return Promise.reject(new DOMException('', 'NotSupportedError'))
      if (options.signal?.aborted) return Promise.reject(options.signal.reason)
      if (options.ifAvailable && held.has(name))
        return Promise.resolve().then(() => callback(null))
      return new Promise<void>((resolve, reject) => {
        const queue = queues.get(name) ?? []
        queues.set(name, queue)
        const pending: LockRequest = {
          callback,
          resolve,
          reject,
          signal: options.signal,
          abort: () => {
            const index = queue.indexOf(pending)
            if (index !== -1) queue.splice(index, 1)
            reject(options.signal?.reason)
          },
        }
        queue.push(pending)
        options.signal?.addEventListener('abort', pending.abort, { once: true })
        grant(name)
      })
    },
  )
  return { request }
}

const stores: AppStore[] = []
let locks: ReturnType<typeof fakeLocks>
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')

function tab(session?: Session) {
  const client = createFakeClient()
  const store = makeStore({ createClient: () => client })
  stores.push(store)
  const current: Session = session ?? {
    messenger: 'telegram',
    credentials: {
      apiUrl: 'https://4100.api.green-api.com',
      idInstance: crypto.randomUUID(),
      apiTokenInstance: crypto.randomUUID(),
    },
  }
  store.dispatch(sessionStarted(current))
  return { store, client, session: current }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  locks = fakeLocks()
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  })
})

afterEach(async () => {
  cleanup()
  for (const store of stores.splice(0)) store.dispatch(loggedOut())
  await flush()
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
  else Reflect.deleteProperty(navigator, 'locks')
  vi.restoreAllMocks()
  vi.useRealTimers()
  sessionStorage.clear()
})

describe('Монопольное получение уведомлений', () => {
  it('вторая вкладка того же инстанса ждёт и не читает очередь', async () => {
    const first = tab()
    const second = tab(first.session)
    await flush()

    expect(first.client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(second.client.receiveNotification).not.toHaveBeenCalled()
    expect(first.store.getState().session.connection).toBe('idle')
    expect(first.store.getState().session.warning).toBeNull()
    expect(second.store.getState().session.connection).toBe('standby')
    expect(second.store.getState().session.warning).toBe(warning)
    expect(locks.request).toHaveBeenLastCalledWith(
      `green-api:${first.session.credentials.idInstance}`,
      { signal: expect.any(AbortSignal) },
      expect.any(Function),
    )
  })

  it('выход владельца отменяет запрос и передаёт очередь ожидающей вкладке', async () => {
    const first = tab()
    const second = tab(first.session)
    second.client.receiveNotification.mockResolvedValueOnce(null)
    await flush()
    const signal = first.client.receiveNotification.mock.calls[0]![1]!

    first.store.dispatch(loggedOut())
    expect(signal.aborted).toBe(true)
    await flush()

    expect(first.client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(second.client.receiveNotification).toHaveBeenCalledTimes(2)
    expect(second.store.getState().session.connection).toBe('online')
    expect(second.store.getState().session.warning).toBeNull()
  })

  it('выход ожидающей вкладки отменяет захват и не оставляет поздних обновлений', async () => {
    const first = tab()
    const second = tab(first.session)
    await flush()
    const signal = locks.request.mock.calls.at(-1)![1].signal!

    second.store.dispatch(loggedOut())
    expect(signal.aborted).toBe(true)
    first.store.dispatch(loggedOut())
    await flush()

    expect(second.client.receiveNotification).not.toHaveBeenCalled()
    expect(second.store.getState().session.connection).toBe('idle')
    expect(second.store.getState().session.warning).toBeNull()
    expect(second.store.getState().session.error).toBeNull()
    const third = tab(first.session)
    await flush()
    expect(third.client.receiveNotification).toHaveBeenCalledTimes(1)
  })

  it('разные инстансы опрашиваются независимо', async () => {
    const first = tab()
    const second = tab()
    await flush()
    expect(first.client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(second.client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(second.store.getState().session.warning).toBeNull()
  })

  it('отмена до асинхронной выдачи замка не запускает очередь', async () => {
    const first = tab()
    first.store.dispatch(loggedOut())
    await flush()
    expect(first.client.receiveNotification).not.toHaveBeenCalled()
    expect(first.store.getState().session.error).toBeNull()
    const second = tab(first.session)
    await flush()
    expect(second.client.receiveNotification).toHaveBeenCalledTimes(1)
  })

  it('смена инстанса во время ожидания отменяет старый захват', async () => {
    const first = tab()
    const second = tab(first.session)
    await flush()
    second.store.dispatch(
      sessionStarted({
        ...second.session,
        credentials: {
          ...second.session.credentials,
          idInstance: crypto.randomUUID(),
        },
      }),
    )
    await flush()
    expect(second.client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(second.store.getState().session.warning).toBeNull()
    first.store.dispatch(loggedOut())
    await flush()
    expect(second.client.receiveNotification).toHaveBeenCalledTimes(1)
  })

  it('ошибка опроса освобождает замок для следующей вкладки', async () => {
    const first = tab()
    first.client.receiveNotification.mockRejectedValueOnce(
      createGreenApiError('auth'),
    )
    const second = tab(first.session)
    await flush()
    expect(first.store.getState().session.connection).toBe('error')
    expect(second.client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(second.store.getState().session.warning).toBeNull()
  })

  it('без Web Locks запускает опрос напрямую', () => {
    Object.defineProperty(navigator, 'locks', { value: undefined })
    const first = tab()
    expect(first.client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(locks.request).not.toHaveBeenCalled()
    expect(first.store.getState().session.warning).toBeNull()
  })

  it('ошибка Web Locks не запускает незащищённый опрос', async () => {
    locks.request.mockRejectedValueOnce(new DOMException('', 'SecurityError'))
    const first = tab()
    await flush()
    expect(first.client.receiveNotification).not.toHaveBeenCalled()
    expect(first.store.getState().session.connection).toBe('error')
    expect(first.store.getState().session.error).toBe(
      'Не удалось запустить получение уведомлений.',
    )
  })

  it('показывает статус в списке и предупреждение в обеих адаптивных областях', async () => {
    const first = tab()
    const second = tab(first.session)
    await flush()
    render(
      <Provider store={second.store}>
        <ChatLayout />
      </Provider>,
    )
    const sidebar = within(
      screen.getByRole('complementary', { name: 'Список чатов' }),
    )
    const conversation = within(
      screen.getByRole('region', { name: 'Переписка' }),
    )
    expect(sidebar.getByRole('status')).toHaveTextContent('В другой вкладке')
    expect(sidebar.getByText(warning)).toHaveClass('notice')
    expect(conversation.getByText(warning)).toHaveClass('notice')

    await act(async () => {
      first.store.dispatch(loggedOut())
      await flush()
    })
    expect(screen.queryAllByText(warning)).toHaveLength(0)
    expect(sidebar.getByRole('status')).toHaveTextContent('Подключаемся')
  })
})
