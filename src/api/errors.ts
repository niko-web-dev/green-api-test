import type { GreenApiError, GreenApiErrorKind } from './types'

const MESSAGES: Record<GreenApiErrorKind, string> = {
  notReady:
    'Инстанс запускается или не авторизован. Проверьте его состояние в кабинете GREEN-API.',
  phoneCheckLimit:
    'Превышен лимит проверок номеров. Повторите попытку примерно через 2 часа.',
  auth: 'Не удалось авторизоваться. Проверьте учётные данные инстанса.',
  quota: 'Исчерпана квота GREEN-API. Проверьте ограничения тарифа.',
  rateLimit: 'Слишком много запросов. Попробуйте позже.',
  webhookSet:
    'Для получения уведомлений очистите webhookUrl в настройках инстанса.',
  badRequest: 'GREEN-API отклонил запрос. Проверьте переданные данные.',
  server: 'GREEN-API вернул ошибку сервера или некорректный ответ.',
  network: 'Не удалось связаться с GREEN-API. Проверьте подключение к сети.',
  aborted: 'Запрос отменён.',
}

// Проверяем происхождение ошибки, а не поля постороннего объекта; слабая ссылка не мешает сборке мусора.
const apiErrors = new WeakSet<Error>()

export function createGreenApiError(
  kind: GreenApiErrorKind,
  status?: number,
): GreenApiError {
  const error = Object.assign(new Error(MESSAGES[kind]), {
    name: 'GreenApiError',
    kind,
    status,
  })
  apiErrors.add(error)
  return error
}

export function isGreenApiError(error: unknown): error is GreenApiError {
  return error instanceof Error && apiErrors.has(error)
}

// Текст берём из таблицы: подменённый message, тело ответа и URL с токеном не попадут в интерфейс.
export function describeError(
  error: unknown,
  fallback = 'Не удалось выполнить запрос к GREEN-API.',
): string {
  if (!isGreenApiError(error)) return fallback
  const text = MESSAGES[error.kind]
  return error.status ? `${text} (HTTP ${error.status})` : text
}
