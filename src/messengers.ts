// Отличия мессенджеров собраны в профилях, чтобы общий код не ветвился по messenger.
import type { GreenApiClient } from './api/greenApiClient'

export type MessengerId = 'max' | 'telegram' | 'whatsapp'

export interface ResolvedChat {
  chatId: string
  title: string
}

export interface MessengerProfile {
  title: string
  typeInstance: 'v3' | 'telegram' | 'whatsapp'
  defaultApiUrl: string
  maxMessageLength: number
  resolveChat(
    client: GreenApiClient,
    digits: string,
    signal?: AbortSignal,
  ): Promise<ResolvedChat | null>
}

export function normalizePhone(input: string): string {
  return input.replace(/\D/g, '')
}

// Продуктовое ограничение: только российские номера (код 7, 11 цифр).
// API MAX принимает и белорусские номера, но приложение намеренно их не поддерживает.
export const PHONE_HINT = 'Российский номер с кодом 7 (11 цифр)'
export function validatePhone(digits: string): string | null {
  return /^7[0-9]{10}$/.test(digits)
    ? null
    : 'Введите российский номер с кодом 7 (11 цифр)'
}

const resolveAccount: MessengerProfile['resolveChat'] = async (
  client,
  digits,
  signal,
) => {
  const { exist, chatId } = await client.checkAccount(Number(digits), signal)
  return exist ? { chatId, title: `+${digits}` } : null
}

// defaultApiUrl — подсказка для формы: хост зависит от инстанса и берётся из кабинета GREEN-API.
export const MESSENGERS: Record<MessengerId, MessengerProfile> = {
  max: {
    title: 'MAX',
    typeInstance: 'v3',
    // Хост из https://green-api.com/v3/docs/request-format/ — не проверено на реальном инстансе.
    defaultApiUrl: 'https://3100.api.green-api.com',
    maxMessageLength: 4000,
    resolveChat: resolveAccount,
  },
  telegram: {
    title: 'Telegram',
    typeInstance: 'telegram',
    defaultApiUrl: 'https://4100.api.green-api.com',
    maxMessageLength: 4096,
    resolveChat: resolveAccount,
  },
  whatsapp: {
    title: 'WhatsApp',
    typeInstance: 'whatsapp',
    defaultApiUrl: 'https://7107.api.greenapi.com',
    maxMessageLength: 20000,
    async resolveChat(client, digits, signal) {
      const account = await client.checkWhatsapp(Number(digits), signal)
      // При enableLidMode=no уведомления используют телефонный chatId, а проверка может вернуть @lid.
      return account.existsWhatsapp
        ? { chatId: `${digits}@c.us`, title: `+${digits}` }
        : null
    },
  },
}
