import { vi } from 'vitest'
import { createGreenApiError } from './errors'
import type { GreenApiClient } from './types'

const waitForAbort: GreenApiClient['receiveNotification'] = (
  _timeout,
  signal,
) =>
  new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(createGreenApiError('aborted'))
      return
    }
    signal?.addEventListener(
      'abort',
      () => reject(createGreenApiError('aborted')),
      { once: true },
    )
  })

export function createFakeClient() {
  return {
    getStateInstance: vi
      .fn<GreenApiClient['getStateInstance']>()
      .mockResolvedValue('authorized'),
    checkAccount: vi.fn<GreenApiClient['checkAccount']>(),
    checkWhatsapp: vi.fn<GreenApiClient['checkWhatsapp']>(),
    sendMessage: vi.fn<GreenApiClient['sendMessage']>(),
    // По умолчанию ждёт отмены: тесты управляют циклом без реальных тайм-аутов.
    receiveNotification:
      vi.fn<GreenApiClient['receiveNotification']>(waitForAbort),
    deleteNotification: vi
      .fn<GreenApiClient['deleteNotification']>()
      .mockResolvedValue(undefined),
  } satisfies GreenApiClient
}
