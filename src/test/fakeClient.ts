import { vi } from 'vitest'
import { GreenApiError } from '../api/greenApiClient'
import type { GreenApiClient } from '../api/greenApiClient'

const waitForAbort: GreenApiClient['receiveNotification'] = (
  _timeout,
  signal,
) =>
  new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new GreenApiError('aborted'))
      return
    }
    signal?.addEventListener(
      'abort',
      () => reject(new GreenApiError('aborted')),
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
