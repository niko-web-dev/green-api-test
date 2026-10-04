import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import chatStyles from './components/ChatWindow.module.css'
import { GreenApiError } from './api/greenApiClient'
import type { ReceivedNotification } from './api/types'
import { makeStore } from './store'
import type { AppStore } from './store'
import { loggedOut } from './store/sessionSlice'
import { createFakeClient } from './test/fakeClient'
import { MESSENGERS } from './messengers'
import incomingText from './test/fixtures/max.docs.incoming-text.json'
import telegramDelivered from './test/fixtures/telegram.live.outgoing-message-status.json'
import telegramRead from './test/fixtures/telegram.live.outgoing-message-status-read.json'
import whatsappSent from './test/fixtures/whatsapp.live.outgoing-message-status-sent.json'
import whatsappDelivered from './test/fixtures/whatsapp.live.outgoing-message-status.json'
import whatsappRead from './test/fixtures/whatsapp.live.outgoing-message-status-read.json'
import resolvedAccount from './test/fixtures/max.docs.check-account.json'

const stores: AppStore[] = []
const phone = '79990000002'
const sentLabel = 'Принято API, доставка не подтверждена'

beforeEach(() => sessionStorage.clear())
afterEach(async () => {
  cleanup()
  // Размонтирование не останавливает листенер стора: отменяем ожидающий запрос явно.
  for (const store of stores) store.dispatch(loggedOut())
  stores.length = 0
  await Promise.resolve()
  sessionStorage.clear()
})

function setup() {
  const client = createFakeClient()
  client.checkAccount.mockResolvedValue(resolvedAccount)
  client.checkWhatsapp.mockResolvedValue({ existsWhatsapp: true })
  let messageId = 0
  client.sendMessage.mockImplementation(async () => ({
    idMessage: `sent-${++messageId}`,
  }))
  const queue: ReceivedNotification[] = []
  let deliver: ((notification: ReceivedNotification) => void) | undefined
  client.receiveNotification.mockImplementation((_timeout, signal) => {
    if (signal?.aborted) return Promise.reject(new GreenApiError('aborted'))
    const notification = queue.shift()
    if (notification) return Promise.resolve(notification)
    // Пустая очередь ждёт события или отмены, не создавая таймеров и busy loop.
    return new Promise((resolve, reject) => {
      const abort = () => {
        deliver = undefined
        reject(new GreenApiError('aborted'))
      }
      deliver = (next) => {
        signal?.removeEventListener('abort', abort)
        deliver = undefined
        resolve(next)
      }
      signal?.addEventListener('abort', abort, { once: true })
    })
  })
  const fakeCreateClient = vi.fn(() => client)
  const store = makeStore({ createClient: fakeCreateClient })
  stores.push(store)
  render(<App store={store} />)
  return {
    client,
    store,
    user: userEvent.setup(),
    notify(notification: ReceivedNotification) {
      if (deliver) deliver(notification)
      else queue.push(notification)
    },
  }
}

type Context = ReturnType<typeof setup>

async function submitLogin({ user }: Context) {
  expect(
    screen.getByRole('heading', { level: 1, name: 'Подключите мессенджер' }),
  ).toBeInTheDocument()
  // Синтетические значения создаются на запуске, реальные учётные данные не нужны.
  const id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) =>
    String((n % 9) + 1),
  ).join('')
  await user.type(screen.getByRole('textbox', { name: 'ID инстанса' }), id)
  await user.type(screen.getByLabelText('API токен'), crypto.randomUUID())
  await user.click(screen.getByRole('button', { name: 'Войти' }))
}

async function login(context: Context) {
  await submitLogin(context)
  const { client } = context
  expect(
    await screen.findByRole('complementary', { name: 'Список чатов' }),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: 'Подключите мессенджер' }),
  ).not.toBeInTheDocument()
  expect(client.getStateInstance).toHaveBeenCalledTimes(1)
}

async function openChat({ user, client }: Context) {
  await user.type(screen.getByRole('textbox', { name: 'Новый чат' }), phone)
  await user.click(screen.getByRole('button', { name: 'Открыть чат' }))
  expect(
    await screen.findByRole('heading', { name: `+${phone}` }),
  ).toBeInTheDocument()
  expect(client.checkAccount).toHaveBeenCalledWith(
    Number(phone),
    expect.any(AbortSignal),
  )
  expect(client.checkWhatsapp).not.toHaveBeenCalled()
}

const feed = () => within(screen.getByRole('list', { name: 'Сообщения' }))

test('на экране входа по умолчанию выбран Telegram и его адрес API', () => {
  setup()
  expect(screen.getByRole('button', { name: 'Telegram' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('button', { name: 'MAX' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(screen.getByRole('button', { name: 'WhatsApp' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(screen.getByRole('textbox', { name: 'API URL' })).toHaveValue(
    MESSENGERS.telegram.defaultApiUrl,
  )
})

test('вход, открытие чата и отправка показывают сообщение с галочкой', async () => {
  const context = setup()
  await login(context)
  await openChat(context)
  await context.user.type(
    screen.getByRole('textbox', { name: 'Сообщение' }),
    'Привет!',
  )
  await context.user.click(
    screen.getByRole('button', { name: 'Отправить сообщение' }),
  )

  expect(await feed().findByLabelText(sentLabel)).toHaveTextContent('✓')
  expect(feed().getByText('Привет!')).toBeInTheDocument()
  expect(context.client.sendMessage).toHaveBeenCalledTimes(1)
  expect(context.client.sendMessage).toHaveBeenCalledWith(
    resolvedAccount.chatId,
    'Привет!',
    expect.any(AbortSignal),
  )
  expect(screen.getByRole('textbox', { name: 'Сообщение' })).toHaveValue('')
})

test('входящие появляются в открытом чате, а новый отправитель добавляется в список', async () => {
  const context = setup()
  await login(context)
  await openChat(context)
  await act(async () => context.notify({ receiptId: 1, body: incomingText }))
  expect(
    await feed().findByText(
      incomingText.messageData.textMessageData.textMessage,
    ),
  ).toBeInTheDocument()
  await waitFor(() =>
    expect(context.client.deleteNotification).toHaveBeenCalledWith(
      1,
      expect.any(AbortSignal),
    ),
  )

  const text = 'Сообщение из нового диалога'
  const name = 'Новый отправитель'
  await act(async () =>
    context.notify({
      receiptId: 2,
      body: {
        ...incomingText,
        idMessage: 'new-incoming',
        senderData: {
          ...incomingText.senderData,
          chatId: '10000003',
          sender: '10000003',
          chatName: name,
          senderName: name,
          senderContactName: name,
          senderPhoneNumber: 79990000003,
        },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: text },
        },
      },
    }),
  )
  const sidebar = within(
    screen.getByRole('complementary', { name: 'Список чатов' }),
  )
  const newChat = await sidebar.findByRole('button', { name: new RegExp(name) })
  expect(sidebar.getAllByRole('listitem')).toHaveLength(2)
  expect(feed().queryByText(text)).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: `+${phone}` })).toBeInTheDocument()
  await context.user.click(newChat)
  expect(await feed().findByText(text)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name })).toBeInTheDocument()
  await waitFor(() =>
    expect(context.client.deleteNotification).toHaveBeenCalledWith(
      2,
      expect.any(AbortSignal),
    ),
  )
})

test('ошибка сохраняет текст, повтор отправляет его, Enter отправляет, Shift+Enter переносит строку', async () => {
  const context = setup()
  await login(context)
  await openChat(context)
  context.client.sendMessage.mockRejectedValueOnce(new GreenApiError('network'))
  const composer = screen.getByRole('textbox', { name: 'Сообщение' })
  await context.user.type(composer, 'Сохранённый текст')
  await context.user.keyboard('{Enter}')

  expect(
    await feed().findByLabelText('Отправка не подтверждена'),
  ).toBeInTheDocument()
  expect(feed().getByText('Сохранённый текст')).toBeInTheDocument()
  expect(feed().getByText('Повтор может создать дубликат.')).toBeInTheDocument()
  expect(context.client.sendMessage).toHaveBeenCalledTimes(1)
  await context.user.click(feed().getByRole('button', { name: 'Повторить' }))
  expect(await feed().findByLabelText(sentLabel)).toHaveTextContent('✓')
  expect(
    feed().queryByRole('button', { name: 'Повторить' }),
  ).not.toBeInTheDocument()
  expect(feed().getAllByText('Сохранённый текст')).toHaveLength(1)
  expect(context.client.sendMessage).toHaveBeenCalledTimes(2)
  expect(context.client.sendMessage).toHaveBeenNthCalledWith(
    2,
    resolvedAccount.chatId,
    'Сохранённый текст',
    expect.any(AbortSignal),
  )

  await context.user.type(composer, 'Первая строка')
  await context.user.keyboard('{Shift>}{Enter}{/Shift}')
  expect(composer).toHaveValue('Первая строка\n')
  expect(context.client.sendMessage).toHaveBeenCalledTimes(2)
  await context.user.type(composer, 'Вторая строка')
  await context.user.keyboard('{Enter}')
  await waitFor(() =>
    expect(feed().getAllByLabelText(sentLabel)).toHaveLength(2),
  )
  expect(feed().getByText('Первая строка Вторая строка')).toBeInTheDocument()
  expect(context.client.sendMessage).toHaveBeenCalledTimes(3)
  expect(context.client.sendMessage).toHaveBeenLastCalledWith(
    resolvedAccount.chatId,
    'Первая строка\nВторая строка',
    expect.any(AbortSignal),
  )
  expect(composer).toHaveValue('')
})

test.each(['MAX', 'WhatsApp'])(
  'смена на %s очищает ошибку входа в интерфейсе и сторе',
  async (messenger) => {
    const context = setup()
    context.client.getStateInstance.mockRejectedValueOnce(
      new GreenApiError('auth', 401),
    )
    await submitLogin(context)
    expect(
      await screen.findByText(
        'Не удалось авторизоваться. Проверьте учётные данные инстанса. (HTTP 401)',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled()
    expect(context.store.getState().session.loginRequestId).toBeNull()
    expect(context.client.receiveNotification).not.toHaveBeenCalled()

    await context.user.click(screen.getByRole('button', { name: messenger }))
    expect(context.store.getState().session.error).toBeNull()
    expect(context.store.getState().session.warning).toBeNull()
    expect(context.store.getState().session.connection).toBe('idle')
    expect(context.store.getState().chats.byId).toEqual({})
    expect(context.store.getState().chats.messagesByChat).toEqual({})
    expect(context.store.getState().chats.error).toBeNull()
    expect(
      screen.queryByText(/Не удалось авторизоваться/),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'ID инстанса' })).toHaveValue('')
    expect(screen.getByLabelText('API токен')).toHaveValue('')
    expect(sessionStorage.length).toBe(0)
  },
)

test('отсутствующий аккаунт показывает понятную ошибку и позволяет проверить другой номер', async () => {
  const context = setup()
  await context.user.click(screen.getByRole('button', { name: 'Telegram' }))
  await login(context)
  context.client.checkAccount.mockResolvedValueOnce({
    exist: false,
    chatId: '',
  })
  await context.user.type(
    screen.getByRole('textbox', { name: 'Новый чат' }),
    phone,
  )
  await context.user.click(screen.getByRole('button', { name: 'Открыть чат' }))
  expect(
    await screen.findByText('Номер не зарегистрирован в Telegram'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Открыть чат' })).toBeEnabled()
  expect(context.store.getState().chats.openRequestId).toBeNull()
  expect(context.store.getState().chats.byId).toEqual({})
  expect(context.client.sendMessage).not.toHaveBeenCalled()
  await context.user.click(screen.getByRole('button', { name: 'Открыть чат' }))
  expect(
    await screen.findByRole('heading', { name: `+${phone}` }),
  ).toBeInTheDocument()
  expect(
    screen.queryByText('Номер не зарегистрирован в Telegram'),
  ).not.toBeInTheDocument()
})

test('выход во время ожидания очищает переписку, смена мессенджера и повторный вход чистые', async () => {
  const context = setup()
  await login(context)
  await openChat(context)
  await act(async () => context.notify({ receiptId: 1, body: incomingText }))
  expect(
    await feed().findByText(
      incomingText.messageData.textMessageData.textMessage,
    ),
  ).toBeInTheDocument()
  await waitFor(() =>
    expect(context.client.receiveNotification).toHaveBeenCalledTimes(2),
  )
  const signal = context.client.receiveNotification.mock.calls[1]![1]!
  await context.user.click(screen.getByRole('button', { name: 'Выйти' }))
  expect(signal.aborted).toBe(true)
  expect(context.store.getState().chats.messagesByChat).toEqual({})
  expect(context.store.getState().chats.seenMessageIds).toEqual({})
  expect(context.store.getState().chats.activeChatId).toBeNull()
  expect(context.store.getState().session.error).toBeNull()
  expect(sessionStorage.length).toBe(0)
  await context.user.click(screen.getByRole('button', { name: 'Telegram' }))
  await submitLogin(context)
  expect(
    await screen.findByRole('heading', { name: 'Telegram' }),
  ).toBeInTheDocument()
  expect(screen.getByText(/Здесь будут ваши диалоги/)).toBeInTheDocument()
  expect(context.store.getState().chats.byId).toEqual({})
  expect(context.store.getState().session.error).toBeNull()
  expect(context.client.receiveNotification).toHaveBeenCalledTimes(3)
  expect(context.client.receiveNotification.mock.calls[2]![1]!.aborted).toBe(
    false,
  )
})

test.each([
  ['Telegram', [telegramDelivered, telegramRead]],
  ['WhatsApp', [whatsappSent, whatsappDelivered, whatsappRead]],
] as const)(
  'статусы %s проходят из очереди в интерфейс без отката',
  async (messenger, notifications) => {
    const context = setup()
    await context.user.click(screen.getByRole('button', { name: messenger }))
    await login(context)
    if (messenger === 'Telegram') await openChat(context)
    else {
      await context.user.type(
        screen.getByRole('textbox', { name: 'Новый чат' }),
        phone,
      )
      await context.user.click(
        screen.getByRole('button', { name: 'Открыть чат' }),
      )
      expect(
        await screen.findByRole('heading', { name: `+${phone}` }),
      ).toBeInTheDocument()
    }
    await context.user.type(
      screen.getByRole('textbox', { name: 'Сообщение' }),
      'Проверка доставки',
    )
    await context.user.click(
      screen.getByRole('button', { name: 'Отправить сообщение' }),
    )
    expect(await feed().findByLabelText(sentLabel)).toHaveTextContent('✓')
    expect(feed().getByLabelText(sentLabel)).toHaveClass(
      chatStyles.deliveryStatus!,
    )

    for (const notification of notifications) {
      await act(async () =>
        context.notify({
          ...notification,
          body: { ...notification.body, idMessage: 'sent-1' },
        }),
      )
      const label =
        notification.body.status === 'sent'
          ? sentLabel
          : notification.body.status === 'delivered'
            ? 'Доставлено'
            : 'Прочитано'
      const indicator = await feed().findByLabelText(label)
      expect(indicator).toHaveTextContent(
        notification.body.status === 'sent' ? '✓' : '✓✓',
      )
      expect(indicator).toHaveClass(
        notification.body.status === 'read'
          ? chatStyles.readStatus!
          : chatStyles.deliveryStatus!,
      )
      await waitFor(() =>
        expect(context.client.deleteNotification).toHaveBeenCalledWith(
          notification.receiptId,
          expect.any(AbortSignal),
        ),
      )
    }

    await act(async () =>
      context.notify({
        receiptId: 9000,
        body: { ...notifications[0].body, idMessage: 'sent-1', status: 'sent' },
      }),
    )
    expect(feed().getByLabelText('Прочитано')).toHaveTextContent('✓✓')
    expect(feed().getAllByRole('listitem')).toHaveLength(1)
    expect(context.store.getState().session.warning).toBeNull()
    await waitFor(() =>
      expect(context.client.deleteNotification).toHaveBeenCalledWith(
        9000,
        expect.any(AbortSignal),
      ),
    )
  },
)
