import { describe, expect, it, vi } from 'vitest'
import { GreenApiError } from './api/greenApiClient'
import type { GreenApiClient, GreenApiErrorKind } from './api/greenApiClient'
import { ENABLED_MESSENGERS, MESSENGERS, normalizePhone } from './messengers'
import type { MessengerId } from './messengers'
import maxAccount from './test/fixtures/max.docs.check-account.json'
import telegramAccount from './test/fixtures/telegram.live.check-account.json'
import whatsappAccount from './test/fixtures/whatsapp.live.check-account.json'

function fakeClient() {
  return {
    getStateInstance: vi.fn<GreenApiClient['getStateInstance']>(),
    checkAccount: vi.fn<GreenApiClient['checkAccount']>(),
    checkWhatsapp: vi.fn<GreenApiClient['checkWhatsapp']>(),
    sendMessage: vi.fn<GreenApiClient['sendMessage']>(),
    receiveNotification: vi.fn<GreenApiClient['receiveNotification']>(),
    deleteNotification: vi.fn<GreenApiClient['deleteNotification']>(),
  } satisfies GreenApiClient
}

describe('Нормализация телефона', () => {
  it.each([
    ['+7 (999) 123-45-67', '79991234567'],
    ['79991234567', '79991234567'],
    ['abc 1.2/3\n4\t5', '12345'],
    ['', ''],
    [' +()-буквы ', ''],
  ])('преобразует «%s» в «%s»', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected)
  })
})

describe('Профили мессенджеров', () => {
  it('сохраняет порядок доступных мессенджеров', () => {
    expect(ENABLED_MESSENGERS).toEqual(['max', 'telegram', 'whatsapp'])
  })

  it.each([
    ['max', 'MAX', 'v3', 4000, 'https://3100.api.green-api.com'],
    [
      'telegram',
      'Telegram',
      'telegram',
      4096,
      'https://4100.api.green-api.com',
    ],
    [
      'whatsapp',
      'WhatsApp',
      'whatsapp',
      20000,
      'https://7107.api.greenapi.com',
    ],
  ] as const)(
    'задаёт параметры %s',
    (id, title, typeInstance, maxMessageLength, defaultApiUrl) => {
      expect(MESSENGERS[id]).toMatchObject({
        id,
        title,
        typeInstance,
        maxMessageLength,
        defaultApiUrl,
      })
      expect(MESSENGERS[id].phoneHint).toMatch(/[А-Яа-я]/)
    },
  )
})

describe.each<MessengerId>(['max', 'telegram', 'whatsapp'])(
  'Валидация российского телефона %s',
  (id) => {
    it.each(['79991234567', '70000000000', '79999999999'])(
      'принимает номер %s',
      (digits) => expect(MESSENGERS[id].validatePhone(digits)).toBeNull(),
    )
    it.each([
      '',
      '7999123456',
      '799912345678',
      '1234567890',
      '123456789012345',
      '89991234567',
      '19991234567',
      '+79991234567',
      '7999 1234567',
      '7abcdefghij',
    ])('отклоняет номер «%s» с русским текстом ошибки', (digits) =>
      expect(MESSENGERS[id].validatePhone(digits)).toBe(
        'Введите российский номер с кодом 7 (11 цифр)',
      ),
    )
  },
)

const accountFixtures = { max: maxAccount, telegram: telegramAccount }
const digits = '79990000002'
const errorKinds: GreenApiErrorKind[] = [
  'auth',
  'quota',
  'rateLimit',
  'webhookSet',
  'badRequest',
  'server',
  'network',
  'aborted',
]

describe.each<MessengerId>(['max', 'telegram', 'whatsapp'])(
  'Разрешение чата %s',
  (id) => {
    it.each([false, true])(
      'использует нужный метод и канонический chatId (с сигналом: %s)',
      async (withSignal) => {
        const client = fakeClient()
        const signal = withSignal ? new AbortController().signal : undefined
        const expectedChatId =
          id === 'whatsapp' ? `${digits}@c.us` : accountFixtures[id].chatId
        if (id === 'whatsapp')
          client.checkWhatsapp.mockResolvedValue(whatsappAccount)
        else client.checkAccount.mockResolvedValue(accountFixtures[id])

        expect(
          await MESSENGERS[id].resolveChat(client, digits, signal),
        ).toEqual({
          chatId: expectedChatId,
          title: `+${digits}`,
        })
        const used =
          id === 'whatsapp' ? client.checkWhatsapp : client.checkAccount
        const unused =
          id === 'whatsapp' ? client.checkAccount : client.checkWhatsapp
        expect(used).toHaveBeenCalledExactlyOnceWith(Number(digits), signal)
        expect(unused).not.toHaveBeenCalled()
        expect(client.sendMessage).not.toHaveBeenCalled()
      },
    )

    it('сообщает, что номер не зарегистрирован', async () => {
      const client = fakeClient()
      client.checkAccount.mockResolvedValue({ exist: false, chatId: '' })
      client.checkWhatsapp.mockResolvedValue({ existsWhatsapp: false })
      await expect(MESSENGERS[id].resolveChat(client, digits)).rejects.toThrow(
        `Номер не зарегистрирован в ${MESSENGERS[id].title}`,
      )
    })

    it.each(errorKinds)(
      'пробрасывает исходную ошибку клиента %s',
      async (kind) => {
        const client = fakeClient()
        const error = new GreenApiError(kind)
        client.checkAccount.mockRejectedValue(error)
        client.checkWhatsapp.mockRejectedValue(error)
        await expect(MESSENGERS[id].resolveChat(client, digits)).rejects.toBe(
          error,
        )
      },
    )
  },
)
