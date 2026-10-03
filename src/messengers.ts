// Отличия собраны в профилях, чтобы общий код использовал единый контракт
// и не обрастал ветвлениями при выборе мессенджера.
import type { GreenApiClient } from './api/greenApiClient'

export type MessengerId = 'max' | 'telegram' | 'whatsapp'

export interface ResolvedChat {
  chatId: string
  title: string
}

export interface MessengerProfile {
  id: MessengerId
  title: string
  typeInstance: 'v3' | 'telegram' | 'whatsapp'
  defaultApiUrl: string
  maxMessageLength: number
  phoneHint: string
  validatePhone(digits: string): string | null
  resolveChat(
    client: GreenApiClient,
    digits: string,
    signal?: AbortSignal,
  ): Promise<ResolvedChat>
}

export function normalizePhone(input: string): string {
  return input.replace(/\D/g, '')
}

function validateRussianPhone(digits: string): string | null {
  return /^7[0-9]{10}$/.test(digits)
    ? null
    : 'Введите российский номер с кодом 7 (11 цифр)'
}

function resolveAccount(title: string): MessengerProfile['resolveChat'] {
  return async (client, digits, signal) => {
    const account = await client.checkAccount(Number(digits), signal)
    if (!account.exist) throw new Error(`Номер не зарегистрирован в ${title}`)
    return { chatId: account.chatId, title: `+${digits}` }
  }
}

export const MESSENGERS: Record<MessengerId, MessengerProfile> = {
  max: {
    id: 'max',
    title: 'MAX',
    typeInstance: 'v3',
    // Хост из https://green-api.com/v3/docs/request-format/ — не проверено на реальном инстансе.
    defaultApiUrl: 'https://3100.api.green-api.com',
    maxMessageLength: 4000,
    phoneHint: 'Российский номер с кодом 7 (11 цифр)',
    validatePhone: validateRussianPhone,
    resolveChat: resolveAccount('MAX'),
  },
  telegram: {
    id: 'telegram',
    title: 'Telegram',
    typeInstance: 'telegram',
    defaultApiUrl: 'https://4100.api.green-api.com',
    maxMessageLength: 4096,
    phoneHint: 'Российский номер с кодом 7 (11 цифр)',
    validatePhone: validateRussianPhone,
    resolveChat: resolveAccount('Telegram'),
  },
  whatsapp: {
    id: 'whatsapp',
    title: 'WhatsApp',
    typeInstance: 'whatsapp',
    defaultApiUrl: 'https://7107.api.greenapi.com',
    maxMessageLength: 20000,
    phoneHint: 'Российский номер с кодом 7 (11 цифр)',
    validatePhone: validateRussianPhone,
    async resolveChat(client, digits, signal) {
      const account = await client.checkWhatsapp(Number(digits), signal)
      if (!account.existsWhatsapp)
        throw new Error('Номер не зарегистрирован в WhatsApp')
      // При enableLidMode=no уведомления используют телефонный chatId, а проверка может вернуть @lid.
      return { chatId: `${digits}@c.us`, title: `+${digits}` }
    },
  },
}

export const ENABLED_MESSENGERS: MessengerId[] = ['max', 'telegram', 'whatsapp']
