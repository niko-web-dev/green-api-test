import { deliveryFailure } from '../notifications/messageStatus'
import type { DeliveryStatus } from '../notifications/types'
import type { ChatsState, Message } from './types'

export function mergeDeliveryStatus(
  current: DeliveryStatus,
  next: DeliveryStatus,
): DeliveryStatus {
  if (current === 'read' || next === 'read') return 'read'
  if (current === 'delivered' || next === 'delivered') return 'delivered'
  return deliveryFailure(current) ? current : next
}

export function applyMessageStatus(
  message: Message,
  status: DeliveryStatus,
): void {
  if (
    message.status === 'read' ||
    (message.status === 'delivered' && status !== 'read')
  )
    return
  const error = deliveryFailure(status)
  if (error) {
    message.status = 'failed'
    message.error = error
  } else if (
    status === 'delivered' ||
    status === 'read' ||
    (status === 'sent' && message.status !== 'failed')
  ) {
    message.status = status
    delete message.error
  }
}

export function clearSettledStatuses(state: ChatsState, chatId: string): void {
  if (
    !state.messagesByChat[chatId]?.some(
      (m) => m.direction === 'out' && m.status === 'sending' && !m.idMessage,
    )
  ) {
    state.pendingStatuses = state.pendingStatuses.filter(
      (event) => event.chatId !== chatId,
    )
  }
}
