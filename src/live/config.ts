import type { Credentials } from '../api/types'

export interface TelegramLiveConfig {
  credentials: Credentials
  phoneInput: string
}

export function readTelegramConfig(
  values: Record<string, string | undefined>,
): TelegramLiveConfig | null {
  const apiUrl = (values.GREEN_API_URL ?? values.API_URL_TG)?.trim()
  const idInstance = (values.GREEN_API_ID ?? values.ID_INSTANCE_TG)?.trim()
  const apiTokenInstance = (
    values.GREEN_API_TOKEN ?? values.API_TOKEN_INSTANCE_TG
  )?.trim()
  const phoneInput = values.GREEN_API_TEST_PHONE?.trim()
  // Номер задаётся явно при запуске, чтобы локальные credentials не запускали отправку сами по себе.
  if (!apiUrl || !idInstance || !apiTokenInstance || !phoneInput) return null
  return { credentials: { apiUrl, idInstance, apiTokenInstance }, phoneInput }
}
