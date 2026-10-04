import type { DeliveryStatus } from './types'

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (
    typeof value === 'string' &&
    ['sent', 'delivered', 'read', 'failed', 'noAccount', 'notInGroup'].includes(
      value,
    )
  )
}

export function deliveryFailure(status: DeliveryStatus): string | null {
  // description приходит извне и может содержать служебные данные: показываем только известные причины.
  switch (status) {
    case 'failed':
      return 'Мессенджер не отправил сообщение. Проверьте состояние инстанса и получателя.'
    case 'noAccount':
      return 'Получатель недоступен: аккаунт не найден или номер скрыт настройками приватности.'
    case 'notInGroup':
      return 'Сообщение не отправлено: аккаунт не состоит в группе.'
    default:
      return null
  }
}
