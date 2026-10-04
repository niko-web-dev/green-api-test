import { isRecord } from './api/greenApiClient'

export interface IncomingText {
  chatId: string
  idMessage: string
  text: string
  timestamp: number
  chatName: string
  typeInstance: string
}

export type DeliveryStatus = 'sent' | 'delivered' | 'read'

export interface OutgoingMessageStatus {
  chatId: string
  idMessage: string
  status: DeliveryStatus
  timestamp: number
  typeInstance: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseNotification(
  body: unknown,
): IncomingText | OutgoingMessageStatus | null {
  if (!isRecord(body)) return null
  if (body.typeWebhook === 'outgoingMessageStatus') {
    const { chatId, idMessage, status, timestamp, instanceData } = body
    if (
      !isRecord(instanceData) ||
      !isNonEmptyString(instanceData.typeInstance) ||
      !isNonEmptyString(chatId) ||
      !isNonEmptyString(idMessage) ||
      typeof status !== 'string' ||
      (status !== 'sent' && status !== 'delivered' && status !== 'read') ||
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      timestamp < 0
    )
      return null
    return {
      chatId,
      idMessage,
      status,
      timestamp,
      typeInstance: instanceData.typeInstance,
    }
  }
  if (body.typeWebhook !== 'incomingMessageReceived') return null

  const { senderData, instanceData, messageData, idMessage, timestamp } = body
  if (
    !isRecord(senderData) ||
    !isRecord(instanceData) ||
    !isRecord(messageData)
  )
    return null

  const { chatId, chatName, senderName } = senderData
  const { typeInstance } = instanceData
  // Только личные чаты: у групп MAX и Telegram отрицательный chatId, у групп WhatsApp — суффикс @g.us.
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
    (messageData.typeMessage === 'extendedTextMessage' ||
      messageData.typeMessage === 'quotedMessage') &&
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
