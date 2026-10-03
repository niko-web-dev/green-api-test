import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GreenApiError } from '../api/greenApiClient'
import type { GreenApiClient } from '../api/greenApiClient'
import type { Credentials, ReceivedNotification } from '../api/types'
import type { MessengerId } from '../messengers'
import { MESSENGERS } from '../messengers'
import { makeStore } from './index'
import {
  sessionStarted,
  loggedOut,
  SESSION_STORAGE_KEY,
  connectionChanged,
  warningChanged,
} from './sessionSlice'
import { incomingReceived } from './chatsSlice'
import {
  login,
  restoreSession,
  openChat,
  sendMessage,
  retrySend,
} from './thunks'
import type { IncomingText } from '../notifications'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

function credentials(): Credentials {
  return {
    apiUrl: 'https://example.com',
    idInstance: crypto.randomUUID(),
    apiTokenInstance: crypto.randomUUID(),
  }
}

const stores: ReturnType<typeof makeStore>[] = []
function setup(messenger: MessengerId = 'telegram', start = true) {
  const receiveSignals: AbortSignal[] = []
  let activeReceives = 0
  let maximumReceives = 0
  const client = {
    getStateInstance: vi
      .fn<GreenApiClient['getStateInstance']>()
      .mockResolvedValue('authorized'),
    checkAccount: vi
      .fn<GreenApiClient['checkAccount']>()
      .mockResolvedValue({ exist: true, chatId: '10000002' }),
    checkWhatsapp: vi
      .fn<GreenApiClient['checkWhatsapp']>()
      .mockResolvedValue({ existsWhatsapp: true }),
    sendMessage: vi
      .fn<GreenApiClient['sendMessage']>()
      .mockResolvedValue({ idMessage: 'sent-id' }),
    receiveNotification: vi.fn<GreenApiClient['receiveNotification']>(
      (_timeout, signal) => {
        if (!signal) throw new Error('Не передан сигнал отмены')
        receiveSignals.push(signal)
        activeReceives++
        maximumReceives = Math.max(maximumReceives, activeReceives)
        return new Promise((_resolve, reject) => {
          const abort = () => {
            activeReceives--
            reject(new GreenApiError('aborted'))
          }
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
      },
    ),
    deleteNotification: vi
      .fn<GreenApiClient['deleteNotification']>()
      .mockResolvedValue(true),
  } satisfies GreenApiClient
  const createClient = vi.fn(() => client)
  const store = makeStore({ createClient })
  stores.push(store)
  const session = { messenger, credentials: credentials() }
  if (start) store.dispatch(sessionStarted(session))
  return {
    store,
    client,
    session,
    receiveSignals,
    createClient,
    activeReceives: () => activeReceives,
    maximumReceives: () => maximumReceives,
  }
}

function incoming(sessionId: number, overrides: Partial<IncomingText> = {}) {
  return {
    sessionId,
    chatId: '10000002',
    idMessage: 'incoming-id',
    text: 'Ответ',
    timestamp: Date.now() / 1000,
    chatName: 'Получатель',
    typeInstance: 'telegram',
    ...overrides,
  }
}

const messages = (store: ReturnType<typeof makeStore>) =>
  Object.values(store.getState().chats.messagesByChat).flat()
async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(async () => {
  for (const store of stores.splice(0)) store.dispatch(loggedOut())
  await flush()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Вход и восстановление', () => {
  it('запускает сессию только после подтверждения авторизации', async () => {
    const { store, client, session } = setup('telegram', false)
    const result = await store.dispatch(login(session))
    expect(login.fulfilled.match(result)).toBe(true)
    expect(client.getStateInstance).toHaveBeenCalledTimes(1)
    expect(store.getState().session.current?.messenger).toBe('telegram')
    expect(store.getState().session.sessionId).toBe(1)
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
  })

  it.each([
    'notAuthorized',
    'blocked',
    'starting',
    'sleepMode',
    'yellowCard',
    'unknownState',
  ])('отклоняет состояние %s без запуска получения', async (state) => {
    const { store, client, session } = setup('telegram', false)
    client.getStateInstance.mockResolvedValue(state)
    const result = await store.dispatch(login(session))
    expect(login.rejected.match(result)).toBe(true)
    expect(store.getState().session.current).toBeNull()
    expect(store.getState().session.error).toMatch(/[А-Яа-я]/)
    expect(client.receiveNotification).not.toHaveBeenCalled()
  })

  it.each(['auth', 'network', 'quota', 'rateLimit'] as const)(
    'возвращает безопасную ошибку %s',
    async (kind) => {
      const { store, client, session } = setup('telegram', false)
      client.getStateInstance.mockRejectedValue(new GreenApiError(kind))
      await store.dispatch(login(session))
      expect(store.getState().session.error).toBe(
        new GreenApiError(kind).message,
      )
      expect(client.receiveNotification).not.toHaveBeenCalled()
    },
  )

  it('не раскрывает исходный текст неожиданной ошибки', async () => {
    const { store, client, session } = setup('telegram', false)
    client.getStateInstance.mockRejectedValue(
      new Error(session.credentials.apiTokenInstance),
    )
    await store.dispatch(login(session))
    expect(store.getState().session.error).toBe(
      'Не удалось выполнить запрос к GREEN-API.',
    )
  })

  it('при параллельных входах принимает только последний запрос', async () => {
    const { store, client, session } = setup('telegram', false)
    const first = deferred<string>()
    client.getStateInstance.mockReturnValueOnce(first.promise)
    const pending = store.dispatch(login(session))
    await store.dispatch(login({ ...session, messenger: 'max' }))
    first.resolve('authorized')
    await pending
    expect(store.getState().session.current?.messenger).toBe('max')
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
  })

  it('сохраняет только sessionStorage, восстанавливает и очищает при выходе', async () => {
    const { store, session } = setup()
    expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)!)).toEqual(
      session,
    )
    expect(localStorage.length).toBe(0)
    const restored = setup('telegram', false)
    await restored.store.dispatch(restoreSession())
    expect(restored.client.getStateInstance).toHaveBeenCalledTimes(1)
    expect(restored.store.getState().session.current?.messenger).toBe(
      'telegram',
    )
    store.dispatch(loggedOut())
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
    expect(store.getState().session.current).toBeNull()
  })

  it.each(['{', '{}', '{"messenger":"other","credentials":{}}'])(
    'игнорирует повреждённое сохранение %s',
    async (raw) => {
      sessionStorage.setItem(SESSION_STORAGE_KEY, raw)
      const { store, client } = setup('telegram', false)
      await store.dispatch(restoreSession())
      expect(client.getStateInstance).not.toHaveBeenCalled()
    },
  )

  it('не падает при запрещённом хранилище', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Запрещено')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Запрещено')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Запрещено')
    })
    const { store, client } = setup()
    await store.dispatch(restoreSession())
    expect(store.getState().session.current?.messenger).toBe('telegram')
    expect(client.getStateInstance).not.toHaveBeenCalled()
    store.dispatch(loggedOut())
    expect(store.getState().session.current).toBeNull()
  })
})

describe('Открытие чата', () => {
  it.each<MessengerId>(['max', 'telegram', 'whatsapp'])(
    'использует нужный метод для %s и кэширует телефон',
    async (messenger) => {
      const { store, client } = setup(messenger)
      await store.dispatch(openChat({ phoneInput: '+7 (999) 000-00-02' }))
      const chatId = messenger === 'whatsapp' ? '79990000002@c.us' : '10000002'
      expect(store.getState().chats.activeChatId).toBe(chatId)
      const used =
        messenger === 'whatsapp' ? client.checkWhatsapp : client.checkAccount
      const unused =
        messenger === 'whatsapp' ? client.checkAccount : client.checkWhatsapp
      expect(used).toHaveBeenCalledExactlyOnceWith(
        79990000002,
        expect.any(AbortSignal),
      )
      expect(unused).not.toHaveBeenCalled()
      await store.dispatch(openChat({ phoneInput: '79990000002' }))
      expect(used).toHaveBeenCalledTimes(1)
      expect(store.getState().chats.order).toEqual([chatId])
    },
  )

  it('проверяет телефон до запроса', async () => {
    const { store, client } = setup()
    await store.dispatch(openChat({ phoneInput: '89990000002' }))
    expect(client.checkAccount).not.toHaveBeenCalled()
    expect(store.getState().chats.error).toContain('кодом 7')
  })

  it.each(['quota', 'rateLimit'] as const)(
    'объясняет ошибку %s',
    async (kind) => {
      const { store, client } = setup()
      client.checkAccount.mockRejectedValue(new GreenApiError(kind))
      await store.dispatch(openChat({ phoneInput: '79990000002' }))
      expect(store.getState().chats.error).toBe(new GreenApiError(kind).message)
      expect(store.getState().chats.order).toEqual([])
    },
  )

  it('отклоняет отсутствующий аккаунт', async () => {
    const { store, client } = setup()
    client.checkAccount.mockResolvedValue({ exist: false, chatId: '' })
    await store.dispatch(openChat({ phoneInput: '79990000002' }))
    expect(store.getState().chats.error).toContain('Номер не найден')
  })
})

describe('Отправка', () => {
  it('меняет sending на sent и сохраняет идентификатор API', async () => {
    const { store, client } = setup()
    await store.dispatch(openChat({ phoneInput: '79990000002' }))
    const sent = deferred<{ idMessage: string }>()
    client.sendMessage.mockReturnValueOnce(sent.promise)
    const request = store.dispatch(
      sendMessage({ chatId: '10000002', text: 'Текст' }),
    )
    expect(messages(store)[0]?.status).toBe('sending')
    sent.resolve({ idMessage: 'api-id' })
    await request
    expect(messages(store)[0]).toMatchObject({
      status: 'sent',
      text: 'Текст',
      idMessage: 'api-id',
    })
    expect(store.getState().chats.seenMessageIds['api-id']).toBe(true)
  })

  it.each([
    ['badRequest', 'failed'],
    ['auth', 'failed'],
    ['quota', 'failed'],
    ['rateLimit', 'failed'],
    ['server', 'failed'],
    ['network', 'unknown'],
    ['aborted', 'unknown'],
  ] as const)(
    'обрабатывает %s как %s без автоповтора',
    async (kind, status) => {
      const { store, client } = setup()
      await store.dispatch(openChat({ phoneInput: '79990000002' }))
      client.sendMessage.mockRejectedValueOnce(new GreenApiError(kind))
      await store.dispatch(sendMessage({ chatId: '10000002', text: 'Текст' }))
      expect(messages(store)[0]).toMatchObject({ status, text: 'Текст' })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.sendMessage).toHaveBeenCalledTimes(1)
    },
  )

  it.each<MessengerId>(['max', 'telegram', 'whatsapp'])(
    'принимает лимит %s и отклоняет превышение',
    async (messenger) => {
      const { store, client } = setup(messenger)
      await store.dispatch(openChat({ phoneInput: '79990000002' }))
      const chatId = store.getState().chats.activeChatId!
      const limit = MESSENGERS[messenger].maxMessageLength
      await store.dispatch(sendMessage({ chatId, text: 'а'.repeat(limit + 1) }))
      expect(client.sendMessage).not.toHaveBeenCalled()
      expect(messages(store)).toHaveLength(0)
      await store.dispatch(sendMessage({ chatId, text: 'а'.repeat(limit) }))
      expect(client.sendMessage).toHaveBeenCalledTimes(1)
    },
  )

  it('отклоняет пустой текст и неизвестный чат', async () => {
    const { store, client } = setup()
    await store.dispatch(sendMessage({ chatId: 'missing', text: ' ' }))
    await store.dispatch(sendMessage({ chatId: 'missing', text: 'Текст' }))
    expect(client.sendMessage).not.toHaveBeenCalled()
    expect(messages(store)).toHaveLength(0)
  })

  it('не считает ошибку создания клиента неопределённой отправкой', async () => {
    const { store, createClient, client } = setup()
    await store.dispatch(openChat({ phoneInput: '79990000002' }))
    createClient.mockImplementationOnce(() => {
      throw new Error('Ошибка клиента')
    })
    await store.dispatch(sendMessage({ chatId: '10000002', text: 'Текст' }))
    expect(client.sendMessage).not.toHaveBeenCalled()
    expect(messages(store)).toHaveLength(0)
  })

  it('не считает некорректное подтверждение доказанной отправкой', async () => {
    const { store, client } = setup()
    await store.dispatch(openChat({ phoneInput: '79990000002' }))
    client.sendMessage.mockResolvedValueOnce({ idMessage: '' })
    await store.dispatch(sendMessage({ chatId: '10000002', text: 'Текст' }))
    expect(messages(store)[0]?.status).toBe('unknown')
  })

  it.each(['badRequest', 'network'] as const)(
    'повторяет %s вручную в той же записи',
    async (kind) => {
      const { store, client } = setup()
      await store.dispatch(openChat({ phoneInput: '79990000002' }))
      client.sendMessage.mockRejectedValueOnce(new GreenApiError(kind))
      await store.dispatch(sendMessage({ chatId: '10000002', text: 'Текст' }))
      const key = messages(store)[0]!.key
      const sent = deferred<{ idMessage: string }>()
      client.sendMessage.mockReturnValueOnce(sent.promise)
      const retry = store.dispatch(retrySend({ key }))
      expect(messages(store)[0]?.status).toBe('sending')
      await store.dispatch(retrySend({ key }))
      expect(client.sendMessage).toHaveBeenCalledTimes(2)
      sent.resolve({ idMessage: 'retry-id' })
      await retry
      expect(messages(store)).toHaveLength(1)
      expect(messages(store)[0]).toMatchObject({
        key,
        status: 'sent',
        idMessage: 'retry-id',
      })
      expect(messages(store)[0]?.error).toBeUndefined()
      await store.dispatch(retrySend({ key }))
      expect(client.sendMessage).toHaveBeenCalledTimes(2)
    },
  )
})

describe('Входящие и порядок чатов', () => {
  it('создаёт неизвестный чат и игнорирует повтор idMessage', () => {
    const { store } = setup()
    const event = incoming(store.getState().session.sessionId)
    store.dispatch(incomingReceived(event))
    store.dispatch(incomingReceived(event))
    expect(messages(store)).toHaveLength(1)
    expect(store.getState().chats.byId[event.chatId]?.title).toBe('Получатель')
    expect(store.getState().chats.activeChatId).toBeNull()
  })

  it('добавляет в существующий чат, сохраняет название и сортирует по активности', async () => {
    const { store } = setup()
    await store.dispatch(openChat({ phoneInput: '79990000002' }))
    const id = store.getState().session.sessionId
    store.dispatch(incomingReceived(incoming(id, { timestamp: 10 })))
    store.dispatch(
      incomingReceived(
        incoming(id, {
          chatId: 'other',
          idMessage: 'other-id',
          timestamp: Date.now() / 1000 + 10,
        }),
      ),
    )
    expect(store.getState().chats.order).toEqual(['other', '10000002'])
    expect(store.getState().chats.byId['10000002']?.title).toBe('+79990000002')
    store.dispatch(
      incomingReceived(
        incoming(id, {
          idMessage: 'later-id',
          timestamp: Date.now() / 1000 + 20,
        }),
      ),
    )
    expect(store.getState().chats.order).toEqual(['10000002', 'other'])
  })

  it('полностью очищает коллекции при смене сессии и выходе', () => {
    const { store, session } = setup()
    const id = store.getState().session.sessionId
    store.dispatch(incomingReceived(incoming(id)))
    store.dispatch(sessionStarted(session))
    expect(messages(store)).toHaveLength(0)
    expect(store.getState().chats.order).toEqual([])
    store.dispatch(incomingReceived(incoming(id + 1)))
    expect(messages(store)).toHaveLength(1)
    store.dispatch(loggedOut())
    expect(messages(store)).toHaveLength(0)
    expect(store.getState().chats.seenMessageIds).toEqual({})
    expect(store.getState().chats.activeChatId).toBeNull()
  })
})

describe('Поздние ответы и отмена', () => {
  it('игнорирует fulfilled и rejected старой сессии даже после нового входа', async () => {
    const { store, session } = setup()
    await store.dispatch(openChat({ phoneInput: '79990000002' }))
    const id = store.getState().session.sessionId
    store.dispatch(loggedOut())
    store.dispatch(sessionStarted(session))
    const before = store.getState()
    store.dispatch(
      openChat.fulfilled(
        { chatId: 'late', title: 'Поздний', lastActivity: 1 },
        'request',
        { sessionId: id, phoneInput: '79990000002' },
      ),
    )
    store.dispatch(
      openChat.rejected(
        null,
        'request',
        { sessionId: id, phoneInput: '79990000002' },
        'Поздняя ошибка',
      ),
    )
    store.dispatch(
      sendMessage.fulfilled(
        { chatId: 'late', key: 'key', idMessage: 'id' },
        'request',
        { sessionId: id, chatId: 'late', text: 'Текст' },
      ),
    )
    store.dispatch(
      sendMessage.rejected(
        null,
        'request',
        { sessionId: id, chatId: 'late', text: 'Текст' },
        { status: 'failed', error: 'Ошибка' },
      ),
    )
    store.dispatch(incomingReceived(incoming(id)))
    store.dispatch(connectionChanged({ sessionId: id, connection: 'error' }))
    store.dispatch(
      warningChanged({ sessionId: id, warning: 'Позднее предупреждение' }),
    )
    expect(store.getState()).toBe(before)
  })

  it('отменяет запрос резолва при выходе и игнорирует ответ клиента, не соблюдающего abort', async () => {
    const { store, client } = setup()
    const check = deferred<{ exist: boolean; chatId: string }>()
    client.checkAccount.mockReturnValueOnce(check.promise)
    const request = store.dispatch(openChat({ phoneInput: '79990000002' }))
    const signal = client.checkAccount.mock.calls[0]![1]!
    store.dispatch(loggedOut())
    expect(signal.aborted).toBe(true)
    check.resolve({ exist: true, chatId: 'late' })
    await request
    expect(store.getState().chats.order).toEqual([])
  })

  it('отменяет отправку при смене сессии без появления старого сообщения', async () => {
    const { store, client, session } = setup()
    await store.dispatch(openChat({ phoneInput: '79990000002' }))
    const sent = deferred<{ idMessage: string }>()
    client.sendMessage.mockReturnValueOnce(sent.promise)
    const request = store.dispatch(
      sendMessage({ chatId: '10000002', text: 'Текст' }),
    )
    const signal = client.sendMessage.mock.calls[0]![2]!
    store.dispatch(sessionStarted(session))
    expect(signal.aborted).toBe(true)
    sent.resolve({ idMessage: 'late' })
    await request
    expect(messages(store)).toHaveLength(0)
    expect(store.getState().chats.seenMessageIds).toEqual({})
  })

  it('выход отменяет незавершённый вход', async () => {
    const { store, client, session } = setup('telegram', false)
    const state = deferred<string>()
    client.getStateInstance.mockReturnValueOnce(state.promise)
    const request = store.dispatch(login(session))
    const signal = client.getStateInstance.mock.calls[0]![0]!
    store.dispatch(loggedOut())
    expect(signal.aborted).toBe(true)
    state.resolve('authorized')
    await request
    expect(store.getState().session.current).toBeNull()
    expect(client.receiveNotification).not.toHaveBeenCalled()
  })
})

describe('Получение через листенер', () => {
  it('запускает ровно один цикл, отменяет при смене сессии и выходе', async () => {
    const {
      store,
      client,
      session,
      receiveSignals,
      activeReceives,
      maximumReceives,
    } = setup()
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(activeReceives()).toBe(1)
    store.dispatch(sessionStarted(session))
    expect(receiveSignals[0]?.aborted).toBe(true)
    expect(client.receiveNotification).toHaveBeenCalledTimes(2)
    expect(activeReceives()).toBe(1)
    expect(maximumReceives()).toBe(1)
    store.dispatch(loggedOut())
    expect(receiveSignals[1]?.aborted).toBe(true)
    expect(activeReceives()).toBe(0)
    await flush()
    expect(client.receiveNotification).toHaveBeenCalledTimes(2)
    expect(store.getState().session.connection).toBe('idle')
  })

  it('парсит уведомления, предупреждает о типе инстанса, дедуплицирует разные receiptId', async () => {
    const { store, client, session } = setup('telegram', false)
    const event: ReceivedNotification = {
      receiptId: 1,
      body: {
        typeWebhook: 'incomingMessageReceived',
        idMessage: 'incoming-id',
        timestamp: 10,
        instanceData: { typeInstance: 'v3' },
        senderData: { chatId: '10000002', chatName: 'Получатель' },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: 'Ответ' },
        },
      },
    }
    client.receiveNotification
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ ...event, receiptId: 2 })
    store.dispatch(sessionStarted(session))
    await flush()
    expect(messages(store)).toHaveLength(1)
    expect(store.getState().session.warning).toContain('не совпадает')
    expect(store.getState().session.connection).toBe('online')
    expect(client.deleteNotification).toHaveBeenCalledTimes(2)
  })

  it.each(['auth', 'webhookSet'] as const)(
    'отображает остановку по %s',
    async (kind) => {
      const { store, client, session } = setup('telegram', false)
      client.receiveNotification.mockRejectedValueOnce(new GreenApiError(kind))
      store.dispatch(sessionStarted(session))
      await flush()
      expect(store.getState().session.connection).toBe('error')
      expect(store.getState().session.error).toBe(
        new GreenApiError(kind).message,
      )
    },
  )

  it('показывает переподключение, затем восстановление', async () => {
    const { store, client, session } = setup('telegram', false)
    client.receiveNotification
      .mockRejectedValueOnce(new GreenApiError('network'))
      .mockResolvedValueOnce(null)
    store.dispatch(sessionStarted(session))
    await flush()
    expect(store.getState().session.connection).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.getState().session.connection).toBe('online')
    expect(store.getState().session.error).toBeNull()
  })

  it('изолирует отмену в разных сторах', () => {
    const first = setup()
    const second = setup()
    first.store.dispatch(loggedOut())
    expect(first.receiveSignals[0]?.aborted).toBe(true)
    expect(second.receiveSignals[0]?.aborted).toBe(false)
    expect(second.activeReceives()).toBe(1)
  })
})

describe('Дополнительные гонки', () => {
  it('не обращается к API с явно устаревшим поколением', async () => {
    const { store, client, session } = setup()
    await store.dispatch(login({ ...session, sessionId: 0 }))
    await store.dispatch(openChat({ phoneInput: '79990000002', sessionId: 0 }))
    await store.dispatch(
      sendMessage({ chatId: '10000002', text: 'Текст', sessionId: 0 }),
    )
    expect(client.getStateInstance).not.toHaveBeenCalled()
    expect(client.checkAccount).not.toHaveBeenCalled()
    expect(client.sendMessage).not.toHaveBeenCalled()
  })

  it('кэширует телефон после открытия ранее созданного входящим чата', async () => {
    const { store, client } = setup()
    store.dispatch(
      incomingReceived(incoming(store.getState().session.sessionId)),
    )
    await store.dispatch(openChat({ phoneInput: '79990000002' }))
    await store.dispatch(openChat({ phoneInput: '79990000002' }))
    expect(client.checkAccount).toHaveBeenCalledTimes(1)
    expect(store.getState().chats.byId['10000002']?.title).toBe('Получатель')
  })

  it('явная отмена отправки оставляет unknown без автоматического повтора', async () => {
    const { store, client } = setup()
    await store.dispatch(openChat({ phoneInput: '79990000002' }))
    const sent = deferred<{ idMessage: string }>()
    client.sendMessage.mockReturnValueOnce(sent.promise)
    const request = store.dispatch(
      sendMessage({ chatId: '10000002', text: 'Текст' }),
    )
    request.abort()
    await request
    expect(client.sendMessage.mock.calls[0]![2]?.aborted).toBe(true)
    expect(messages(store)[0]?.status).toBe('unknown')
    sent.resolve({ idMessage: 'late-id' })
    await flush()
    expect(messages(store)[0]?.status).toBe('unknown')
    expect(client.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('не обрабатывает позднее уведомление отменённого цикла', async () => {
    const { store, client, session } = setup('telegram', false)
    const received = deferred<ReceivedNotification | null>()
    client.receiveNotification.mockReturnValueOnce(received.promise)
    store.dispatch(sessionStarted(session))
    store.dispatch(loggedOut())
    received.resolve({
      receiptId: 1,
      body: {
        typeWebhook: 'incomingMessageReceived',
        idMessage: 'late-id',
        timestamp: 1,
        instanceData: { typeInstance: 'telegram' },
        senderData: { chatId: '10000002', chatName: 'Получатель' },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: 'Поздний ответ' },
        },
      },
    })
    await flush()
    expect(messages(store)).toHaveLength(0)
    expect(client.deleteNotification).not.toHaveBeenCalled()
    expect(store.getState().session.connection).toBe('idle')
  })
})

describe('Безопасная диагностика HTTP', () => {
  it.each([400, 404, 422])(
    'показывает код %s без исходного текста ошибки',
    async (status) => {
      const { store, client, session } = setup('telegram', false)
      const error = new GreenApiError('badRequest', status)
      error.message = session.credentials.apiTokenInstance
      client.getStateInstance.mockRejectedValueOnce(error)
      await store.dispatch(login(session))
      expect(store.getState().session.error).toBe(
        `GREEN-API отклонил запрос. Проверьте переданные данные. (HTTP ${status})`,
      )
    },
  )
})
