/// <reference types="node" />

import { loadEnv } from 'vite'
import { describe, it } from 'vitest'
import { makeStore } from '../store'
import { login, openChat, sendMessage } from '../store/thunks'
import { loggedOut } from '../store/sessionSlice'
import { readTelegramConfig } from './config'

const config = readTelegramConfig(loadEnv('live', process.cwd(), ''))

describe.skipIf(!config)('Живой обмен через Telegram', () => {
  it('входит, открывает чат, отправляет и получает ответ второго тестового аккаунта', async () => {
    if (!config) return
    const store = makeStore()
    try {
      const signedIn = await store.dispatch(
        login({
          messenger: 'telegram',
          credentials: config.credentials,
        }),
      )
      if (
        !login.fulfilled.match(signedIn) ||
        !store.getState().session.current
      ) {
        throw new Error(
          store.getState().session.error ??
            'Вход не завершён: запрос был отменён или состояние инстанса изменилось.',
        )
      }
      const opened = await store.dispatch(
        openChat({ phoneInput: config.phoneInput }),
      )
      if (!openChat.fulfilled.match(opened))
        throw new Error(
          store.getState().chats.error ?? 'Не удалось открыть тестовый чат.',
        )
      const chatId = opened.payload.chatId
      const marker = crypto.randomUUID()
      const sent = await store.dispatch(
        sendMessage({
          chatId,
          text: `Проверка обмена. Ответьте со второго тестового аккаунта, скопировав код: ${marker}`,
        }),
      )
      if (!sendMessage.fulfilled.match(sent))
        throw new Error(
          store.getState().chats.error ?? 'Отправка не подтверждена.',
        )
      console.info(
        'Отправка подтверждена. Ответьте со второго тестового аккаунта кодом из сообщения; ожидание — две минуты.',
      )
      const deadline = Date.now() + 120_000
      while (Date.now() < deadline) {
        const state = store.getState()
        if (state.session.warning)
          throw new Error('Инстанс не соответствует Telegram.')
        if (state.session.connection === 'error')
          throw new Error(
            state.session.error ??
              'Получение уведомлений остановлено. Проверьте настройки инстанса.',
          )
        const answered = state.chats.messagesByChat[chatId]?.some(
          (message) =>
            message.direction === 'in' && message.text.includes(marker),
        )
        if (answered) return
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error(
        'За две минуты не получен ответ с проверочным кодом от второго тестового аккаунта.',
      )
    } finally {
      store.dispatch(loggedOut())
    }
  }, 150_000)
})
