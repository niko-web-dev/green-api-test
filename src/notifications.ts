import type { NotificationBody } from './api/types'

export interface IncomingText {
  chatId: string
  idMessage: string
  text: string
  timestamp: number
  chatName: string
  typeInstance: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

// Даже при null цикл получения обязан вызвать deleteNotification и продолжить
// работу: неподдерживаемое или повреждённое уведомление не должно блокировать очередь.
export function parseNotification(body: NotificationBody): IncomingText | null {
  if (!isRecord(body) || body.typeWebhook !== 'incomingMessageReceived')
    return null

  const { senderData, instanceData, messageData, idMessage, timestamp } = body
  if (
    !isRecord(senderData) ||
    !isRecord(instanceData) ||
    !isRecord(messageData)
  )
    return null

  const { chatId, chatName, senderName } = senderData
  const { typeInstance } = instanceData
  if (
    !isNonEmptyString(chatId) ||
    chatId.startsWith('-') ||
    chatId.endsWith('@g.us') ||
    !isNonEmptyString(idMessage) ||
    !isNonEmptyString(typeInstance) ||
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    (chatName !== undefined && typeof chatName !== 'string') ||
    (senderName !== undefined && typeof senderName !== 'string')
  )
    return null

  let text: unknown
  if (
    messageData.typeMessage === 'textMessage' &&
    isRecord(messageData.textMessageData)
  ) {
    text = messageData.textMessageData.textMessage
  } else if (
    messageData.typeMessage === 'extendedTextMessage' &&
    isRecord(messageData.extendedTextMessageData)
  ) {
    text = messageData.extendedTextMessageData.text
  } else {
    return null
  }

  if (typeof text !== 'string') return null

  return {
    chatId,
    idMessage,
    text,
    timestamp,
    chatName: chatName || senderName || chatId,
    typeInstance,
  }
}
