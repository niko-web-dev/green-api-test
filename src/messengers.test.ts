import { describe, expect, it } from 'vitest'
import { createFakeClient } from './test/fakeClient'
import { MESSENGERS, normalizePhone, validatePhone } from './messengers'
import type { MessengerId } from './messengers'
import maxAccount from './test/fixtures/max.docs.check-account.json'
import telegramAccount from './test/fixtures/telegram.live.check-account.json'
import whatsappAccount from './test/fixtures/whatsapp.live.check-account.json'

describe('Нормализация телефона', () => {
  it.each([
    ['+7 (999) 123-45-67', '79991234567'],
    ['abc 1.2/3\n4\t5', '12345'],
    ['', ''],
  ])('преобразует «%s» в «%s»', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected)
  })
  it.each([
    '79991234567',
    '',
    '7999123456',
    '799912345678',
    '89991234567',
    '19991234567',
  ])('проверяет российский номер «%s»', (digits) => {
    expect(validatePhone(digits)).toBe(
      digits === '79991234567'
        ? null
        : 'Введите российский номер с кодом 7 (11 цифр)',
    )
  })
})

const digits = '79990000002'
const accountFixtures = { max: maxAccount, telegram: telegramAccount }
describe.each<MessengerId>(['max', 'telegram', 'whatsapp'])(
  'Разрешение чата %s',
  (id) => {
    it('использует канонический chatId и сигнал', async () => {
      const client = createFakeClient()
      const signal = new AbortController().signal
      if (id === 'whatsapp')
        client.checkWhatsapp.mockResolvedValue(whatsappAccount)
      else client.checkAccount.mockResolvedValue(accountFixtures[id])
      expect(await MESSENGERS[id].resolveChat(client, digits, signal)).toEqual({
        chatId:
          id === 'whatsapp' ? `${digits}@c.us` : accountFixtures[id].chatId,
        title: `+${digits}`,
      })
      const used =
        id === 'whatsapp' ? client.checkWhatsapp : client.checkAccount
      const unused =
        id === 'whatsapp' ? client.checkAccount : client.checkWhatsapp
      expect(used).toHaveBeenCalledExactlyOnceWith(Number(digits), signal)
      expect(unused).not.toHaveBeenCalled()
    })
    it('возвращает null для отсутствующего номера', async () => {
      const client = createFakeClient()
      client.checkAccount.mockResolvedValue({ exist: false, chatId: '' })
      client.checkWhatsapp.mockResolvedValue({ existsWhatsapp: false })
      await expect(
        MESSENGERS[id].resolveChat(client, digits),
      ).resolves.toBeNull()
    })
  },
)
