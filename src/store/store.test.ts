import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GreenApiError, describeError } from '../api/greenApiClient'
import { createFakeClient } from '../test/fakeClient'
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
import { incomingReceived, selectChatList } from './chatsSlice'
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

const sid = (store: ReturnType<typeof makeStore>) =>
  store.getState().session.sessionId

const stores: ReturnType<typeof makeStore>[] = []
function setup(messenger: MessengerId = 'telegram', start = true) {
  const receiveSignals: AbortSignal[] = []
  let activeReceives = 0
  let maximumReceives = 0
  const client = createFakeClient()
  client.checkAccount.mockResolvedValue({ exist: true, chatId: '10000002' })
  client.checkWhatsapp.mockResolvedValue({ existsWhatsapp: true })
  client.sendMessage.mockResolvedValue({ idMessage: 'sent-id' })
  client.receiveNotification.mockImplementation((_timeout, signal) => {
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
  })
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
  it('авторизация запускает получение уведомлений', async () => {
    const { store, client, session } = setup('telegram', false)
    const result = await store.dispatch(
      login({ ...session, sessionId: sid(store) }),
    )
    expect(login.fulfilled.match(result)).toBe(true)
    expect(client.getStateInstance).toHaveBeenCalledTimes(1)
    expect(store.getState().session.current?.messenger).toBe('telegram')
    expect(store.getState().session.sessionId).toBe(1)
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
  })

  it.each(['notAuthorized', 'unknownState'])(
    'отклоняет состояние инстанса: %s',
    async (state) => {
      const { store, client, session } = setup('telegram', false)
      client.getStateInstance.mockResolvedValue(state)
      const result = await store.dispatch(
        login({ ...session, sessionId: sid(store) }),
      )
      expect(login.rejected.match(result)).toBe(true)
      expect(store.getState().session.current).toBeNull()
      expect(store.getState().session.error).toBe(
        state === 'notAuthorized'
          ? 'Инстанс не авторизован. Авторизуйте аккаунт в кабинете GREEN-API.'
          : 'Инстанс пока не готов к работе. Проверьте его состояние в кабинете GREEN-API.',
      )
      expect(client.receiveNotification).not.toHaveBeenCalled()
    },
  )

  it.each(['auth'] as const)(
    'возвращает безопасную ошибку %s',
    async (kind) => {
      const { store, client, session } = setup('telegram', false)
      client.getStateInstance.mockRejectedValue(new GreenApiError(kind))
      await store.dispatch(login({ ...session, sessionId: sid(store) }))
      expect(store.getState().session.error).toBe(
        describeError(new GreenApiError(kind)),
      )
      expect(client.receiveNotification).not.toHaveBeenCalled()
    },
  )

  it('скрывает текст неожиданной ошибки', async () => {
    const { store, client, session } = setup('telegram', false)
    client.getStateInstance.mockRejectedValue(
      new Error(session.credentials.apiTokenInstance),
    )
    await store.dispatch(login({ ...session, sessionId: sid(store) }))
    expect(store.getState().session.error).toBe(
      'Не удалось выполнить запрос к GREEN-API.',
    )
  })

  it('последний запрос входа побеждает', async () => {
    const { store, client, session } = setup('telegram', false)
    const first = deferred<string>()
    client.getStateInstance.mockReturnValueOnce(first.promise)
    const pending = store.dispatch(login({ ...session, sessionId: sid(store) }))
    await store.dispatch(
      login({ ...session, messenger: 'max', sessionId: sid(store) }),
    )
    first.resolve('authorized')
    await pending
    expect(store.getState().session.current?.messenger).toBe('max')
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
  })

  it('восстанавливает и очищает sessionStorage', async () => {
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

  it.each(['{', '{"messenger":"other","credentials":{}}'])(
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
    'кэширует канонический чат: %s',
    async (messenger) => {
      const { store, client } = setup(messenger)
      await store.dispatch(
        openChat({ sessionId: sid(store), phoneInput: '+7 (999) 000-00-02' }),
      )
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
      await store.dispatch(
        openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
      )
      expect(used).toHaveBeenCalledTimes(1)
      expect(selectChatList(store.getState()).map((c) => c.chatId)).toEqual([
        chatId,
      ])
    },
  )

  it('проверяет телефон до запроса', async () => {
    const { store, client } = setup()
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '89990000002' }),
    )
    expect(client.checkAccount).not.toHaveBeenCalled()
    expect(store.getState().chats.error).toContain('кодом 7')
  })

  it.each(['phoneCheckLimit'] as const)('объясняет ошибку %s', async (kind) => {
    const { store, client } = setup()
    client.checkAccount.mockRejectedValue(new GreenApiError(kind))
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
    expect(store.getState().chats.error).toBe(
      describeError(new GreenApiError(kind)),
    )
    expect(selectChatList(store.getState()).map((c) => c.chatId)).toEqual([])
  })

  it('отклоняет отсутствующий аккаунт', async () => {
    const { store, client } = setup()
    client.checkAccount.mockResolvedValue({ exist: false, chatId: '' })
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
    expect(store.getState().chats.error).toBe(
      'Номер не зарегистрирован в Telegram',
    )
  })
})

describe('Отправка', () => {
  it('подтверждённая отправка становится sent', async () => {
    const { store, client } = setup()
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
    const sent = deferred<{ idMessage: string }>()
    client.sendMessage.mockReturnValueOnce(sent.promise)
    const request = store.dispatch(
      sendMessage({ sessionId: sid(store), chatId: '10000002', text: 'Текст' }),
    )
    expect(messages(store)[0]?.status).toBe('sending')
    sent.resolve({ idMessage: 'api-id' })
    await request
    expect(messages(store)[0]).toMatchObject({
      status: 'sent',
      text: 'Текст',
      idMessage: 'api-id',
    })
  })

  it.each([
    ['badRequest', 'failed'],
    ['network', 'unknown'],
    ['aborted', 'unknown'],
  ] as const)(
    'обрабатывает %s как %s без автоповтора',
    async (kind, status) => {
      const { store, client } = setup()
      await store.dispatch(
        openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
      )
      client.sendMessage.mockRejectedValueOnce(new GreenApiError(kind))
      await store.dispatch(
        sendMessage({
          sessionId: sid(store),
          chatId: '10000002',
          text: 'Текст',
        }),
      )
      expect(messages(store)[0]).toMatchObject({
        status,
        text: 'Текст',
        error:
          kind === 'badRequest'
            ? describeError(new GreenApiError(kind))
            : 'Не удалось подтвердить отправку. Ручной повтор может создать дубликат.',
      })
      expect(store.getState().chats.error).toBeNull()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.sendMessage).toHaveBeenCalledTimes(1)
    },
  )

  it.each<MessengerId>(['telegram'])(
    'принимает лимит %s и отклоняет превышение',
    async (messenger) => {
      const { store, client } = setup(messenger)
      await store.dispatch(
        openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
      )
      const chatId = store.getState().chats.activeChatId!
      const limit = MESSENGERS[messenger].maxMessageLength
      await store.dispatch(
        sendMessage({
          sessionId: sid(store),
          chatId,
          text: 'а'.repeat(limit + 1),
        }),
      )
      expect(client.sendMessage).not.toHaveBeenCalled()
      expect(messages(store)).toHaveLength(0)
      await store.dispatch(
        sendMessage({ sessionId: sid(store), chatId, text: 'а'.repeat(limit) }),
      )
      expect(client.sendMessage).toHaveBeenCalledTimes(1)
    },
  )

  it('отклоняет пустой текст и неизвестный чат', async () => {
    const { store, client } = setup()
    await store.dispatch(
      sendMessage({ sessionId: sid(store), chatId: 'missing', text: ' ' }),
    )
    await store.dispatch(
      sendMessage({ sessionId: sid(store), chatId: 'missing', text: 'Текст' }),
    )
    expect(client.sendMessage).not.toHaveBeenCalled()
    expect(messages(store)).toHaveLength(0)
  })

  it('неверное подтверждение оставляет unknown', async () => {
    const { store, client } = setup()
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
    client.sendMessage.mockResolvedValueOnce({ idMessage: '' })
    await store.dispatch(
      sendMessage({ sessionId: sid(store), chatId: '10000002', text: 'Текст' }),
    )
    expect(messages(store)[0]?.status).toBe('unknown')
  })

  it.each(['network'] as const)(
    'повторяет %s вручную в той же записи',
    async (kind) => {
      const { store, client } = setup()
      await store.dispatch(
        openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
      )
      client.sendMessage.mockRejectedValueOnce(new GreenApiError(kind))
      await store.dispatch(
        sendMessage({
          sessionId: sid(store),
          chatId: '10000002',
          text: 'Текст',
        }),
      )
      const key = messages(store)[0]!.key
      const sent = deferred<{ idMessage: string }>()
      client.sendMessage.mockReturnValueOnce(sent.promise)
      const retry = store.dispatch(retrySend({ sessionId: sid(store), key }))
      expect(messages(store)[0]?.status).toBe('sending')
      await store.dispatch(retrySend({ sessionId: sid(store), key }))
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
      await store.dispatch(retrySend({ sessionId: sid(store), key }))
      expect(client.sendMessage).toHaveBeenCalledTimes(2)
    },
  )
})

describe('Входящие и порядок чатов', () => {
  it('входящее создаёт чат без дублей', () => {
    const { store } = setup()
    const event = incoming(store.getState().session.sessionId)
    store.dispatch(incomingReceived(event))
    store.dispatch(incomingReceived(event))
    expect(messages(store)).toHaveLength(1)
    expect(store.getState().chats.byId[event.chatId]?.title).toBe('Получатель')
    expect(store.getState().chats.activeChatId).toBeNull()
  })

  it('входящие упорядочивают чаты по активности', async () => {
    const { store } = setup()
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
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
    expect(selectChatList(store.getState()).map((c) => c.chatId)).toEqual([
      'other',
      '10000002',
    ])
    expect(store.getState().chats.byId['10000002']?.title).toBe('+79990000002')
    store.dispatch(
      incomingReceived(
        incoming(id, {
          idMessage: 'later-id',
          timestamp: Date.now() / 1000 + 20,
        }),
      ),
    )
    expect(selectChatList(store.getState()).map((c) => c.chatId)).toEqual([
      '10000002',
      'other',
    ])
  })

  it('смена сессии очищает чаты', () => {
    const { store, session } = setup()
    const id = store.getState().session.sessionId
    store.dispatch(incomingReceived(incoming(id)))
    store.dispatch(sessionStarted(session))
    expect(messages(store)).toHaveLength(0)
    expect(selectChatList(store.getState()).map((c) => c.chatId)).toEqual([])
    store.dispatch(incomingReceived(incoming(id + 1)))
    expect(messages(store)).toHaveLength(1)
    store.dispatch(loggedOut())
    expect(messages(store)).toHaveLength(0)
    expect(store.getState().chats.seenMessageIds).toEqual({})
    expect(store.getState().chats.activeChatId).toBeNull()
  })
})

describe('Поздние ответы и отмена', () => {
  it('новая сессия отсекает старые действия', async () => {
    const { store, session } = setup()
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
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

  it('выход отменяет проверку номера', async () => {
    const { store, client } = setup()
    const check = deferred<{ exist: boolean; chatId: string }>()
    client.checkAccount.mockReturnValueOnce(check.promise)
    const request = store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
    const signal = client.checkAccount.mock.calls[0]![1]!
    store.dispatch(loggedOut())
    expect(signal.aborted).toBe(true)
    check.resolve({ exist: true, chatId: 'late' })
    await request
    expect(selectChatList(store.getState()).map((c) => c.chatId)).toEqual([])
  })

  it('смена сессии отменяет отправку', async () => {
    const { store, client, session } = setup()
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
    const sent = deferred<{ idMessage: string }>()
    client.sendMessage.mockReturnValueOnce(sent.promise)
    const request = store.dispatch(
      sendMessage({ sessionId: sid(store), chatId: '10000002', text: 'Текст' }),
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
    const request = store.dispatch(login({ ...session, sessionId: sid(store) }))
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
  it('одновременно работает один цикл', async () => {
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

  it('разные receiptId не дублируют сообщение', async () => {
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

  it.each(['webhookSet'] as const)(
    'отображает остановку по %s',
    async (kind) => {
      const { store, client, session } = setup('telegram', false)
      client.receiveNotification.mockRejectedValueOnce(new GreenApiError(kind))
      store.dispatch(sessionStarted(session))
      await flush()
      expect(store.getState().session.connection).toBe('error')
      expect(store.getState().session.error).toBe(
        describeError(new GreenApiError(kind)),
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

  it('устаревшее поколение не вызывает API', async () => {
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

  it('входящий чат получает кэш телефона', async () => {
    const { store, client } = setup()
    store.dispatch(
      incomingReceived(incoming(store.getState().session.sessionId)),
    )
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
    expect(client.checkAccount).toHaveBeenCalledTimes(1)
    expect(store.getState().chats.byId['10000002']?.title).toBe('Получатель')
  })

  it('отмена отправки оставляет unknown', async () => {
    const { store, client } = setup()
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
    const sent = deferred<{ idMessage: string }>()
    client.sendMessage.mockReturnValueOnce(sent.promise)
    const request = store.dispatch(
      sendMessage({ sessionId: sid(store), chatId: '10000002', text: 'Текст' }),
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

  it('отмена отсекает позднее уведомление', async () => {
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

describe('Восстановление и открытие', () => {
  it('неудачное восстановление очищает сохранение', async () => {
    const { session } = setup()
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    const { store, client } = setup('telegram', false)
    client.getStateInstance.mockRejectedValueOnce(new GreenApiError('auth'))
    await store.dispatch(restoreSession())
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
    expect(store.getState().session.error).toBe(
      describeError(new GreenApiError('auth')),
    )
  })

  it('последний запрос чата остаётся активным', async () => {
    const { store, client } = setup()
    const first = deferred<{ exist: boolean; chatId: string }>()
    client.checkAccount
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ exist: true, chatId: 'second' })
    const pending = store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000002' }),
    )
    expect(store.getState().chats.openRequestId).not.toBeNull()
    await store.dispatch(
      openChat({ sessionId: sid(store), phoneInput: '79990000003' }),
    )
    first.resolve({ exist: true, chatId: 'first' })
    await pending
    expect(store.getState().chats.activeChatId).toBe('second')
    expect(store.getState().chats.openRequestId).toBeNull()
  })

  it('поздний сбой восстановления сохраняет новый вход', async () => {
    const { session } = setup()
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    const { store, client } = setup('telegram', false)
    const old = deferred<string>()
    client.getStateInstance.mockReturnValueOnce(old.promise)
    const restoring = store.dispatch(restoreSession())
    await store.dispatch(
      login({ ...session, messenger: 'max', sessionId: sid(store) }),
    )
    old.reject(new GreenApiError('network'))
    await restoring
    expect(
      JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)!).messenger,
    ).toBe('max')
  })
})

function queuedText(receiptId: number): ReceivedNotification {
  return {
    receiptId,
    body: {
      typeWebhook: 'incomingMessageReceived',
      idMessage: `queued-${receiptId}`,
      timestamp: receiptId,
      instanceData: { typeInstance: 'telegram' },
      senderData: { chatId: '10000002', chatName: 'Получатель' },
      messageData: {
        typeMessage: 'textMessage',
        textMessageData: { textMessage: `Очередь ${receiptId}` },
      },
    },
  }
}

describe('Очередь и восстановление после обрыва', () => {
  it('после входа обрабатывает накопленную очередь FIFO и ждёт подтверждения перед следующим receive', async () => {
    const { store, client, session } = setup('telegram', false)
    const acknowledged = deferred<void>()
    client.receiveNotification
      .mockResolvedValueOnce(queuedText(1))
      .mockResolvedValueOnce(queuedText(2))
    client.deleteNotification.mockReturnValueOnce(acknowledged.promise)
    await store.dispatch(login({ ...session, sessionId: sid(store) }))
    await flush()
    expect(messages(store).map((m) => m.text)).toEqual(['Очередь 1'])
    expect(client.receiveNotification).toHaveBeenCalledTimes(1)
    expect(client.deleteNotification.mock.calls.map(([id]) => id)).toEqual([1])
    acknowledged.resolve()
    await flush()
    expect(messages(store).map((m) => m.text)).toEqual([
      'Очередь 1',
      'Очередь 2',
    ])
    expect(client.deleteNotification.mock.calls.map(([id]) => id)).toEqual([
      1, 2,
    ])
    expect(client.receiveNotification).toHaveBeenCalledTimes(3)
    expect(store.getState().session.connection).toBe('online')
  })

  it('после 30 секунд без сети повторно подтверждает событие без дубля и получает следующее', async () => {
    const { store, client, session } = setup('telegram', false)
    const event = queuedText(1)
    client.receiveNotification.mockResolvedValueOnce(event)
    client.deleteNotification.mockRejectedValueOnce(
      new GreenApiError('network'),
    )
    // Последующие receive выполнятся на 1, 3, 7 и 15 секундах; сеть вернётся на 30-й.
    for (let i = 0; i < 4; i++)
      client.receiveNotification.mockRejectedValueOnce(
        new GreenApiError('network'),
      )
    client.receiveNotification
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(queuedText(2))
    store.dispatch(sessionStarted(session))
    await flush()
    expect(store.getState().session.connection).toBe('reconnecting')
    expect(messages(store).map((m) => m.text)).toEqual(['Очередь 1'])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(store.getState().session.connection).toBe('reconnecting')
    expect(client.receiveNotification).toHaveBeenCalledTimes(5)
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.getState().session.connection).toBe('online')
    expect(store.getState().session.error).toBeNull()
    expect(messages(store).map((m) => m.text)).toEqual([
      'Очередь 1',
      'Очередь 2',
    ])
    expect(client.deleteNotification.mock.calls.map(([id]) => id)).toEqual([
      1, 1, 2,
    ])
    expect(client.receiveNotification).toHaveBeenCalledTimes(8)
    expect(client.sendMessage).not.toHaveBeenCalled()
    store.dispatch(loggedOut())
    await flush()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['receive', 'пауза'])(
    'выход во время %s отменяет старый цикл без ошибок, новый вход запускает чистый',
    async (phase) => {
      const { store, client, session, receiveSignals, activeReceives } = setup(
        'telegram',
        false,
      )
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const unhandled = vi.fn()
      window.addEventListener('unhandledrejection', unhandled)
      try {
        if (phase === 'пауза')
          client.receiveNotification.mockRejectedValueOnce(
            new GreenApiError('network'),
          )
        store.dispatch(sessionStarted(session))
        store.dispatch(incomingReceived(incoming(sid(store))))
        await flush()
        store.dispatch(loggedOut())
        await flush()
        expect(activeReceives()).toBe(0)
        expect(receiveSignals.every((signal) => signal.aborted)).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
        expect(store.getState().session.error).toBeNull()
        expect(store.getState().chats.byId).toEqual({})
        expect(store.getState().chats.messagesByChat).toEqual({})
        expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
        client.receiveNotification.mockResolvedValueOnce(null)
        await store.dispatch(login({ ...session, sessionId: sid(store) }))
        await flush()
        expect(store.getState().session.connection).toBe('online')
        expect(store.getState().session.error).toBeNull()
        expect(store.getState().chats.byId).toEqual({})
        expect(activeReceives()).toBe(1)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(client.receiveNotification).toHaveBeenCalledTimes(3)
        expect(activeReceives()).toBe(1)
        expect(consoleError).not.toHaveBeenCalled()
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        window.removeEventListener('unhandledrejection', unhandled)
      }
    },
  )
})
