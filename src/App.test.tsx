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
import { GreenApiError } from './api/greenApiClient'
import type { ReceivedNotification } from './api/types'
import { makeStore } from './store'
import type { AppStore } from './store'
import { loggedOut } from './store/sessionSlice'
import { createFakeClient } from './test/fakeClient'
import incomingText from './test/fixtures/max.docs.incoming-text.json'
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
    user: userEvent.setup(),
    notify(notification: ReceivedNotification) {
      if (deliver) deliver(notification)
      else queue.push(notification)
    },
  }
}

type Context = ReturnType<typeof setup>

async function login({ user, client }: Context) {
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
