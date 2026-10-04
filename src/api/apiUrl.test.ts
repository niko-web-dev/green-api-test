import { describe, expect, it, vi } from 'vitest'
import { createGreenApiClient } from './greenApiClient'

describe('Безопасный адрес API', () => {
  it.each([
    'http://4100.api.green-api.com',
    'https://4100.api.green-api.com.evil.test',
    'https://evil.test',
    'https://green-api.com',
    'https://user:password@4100.api.green-api.com',
    'https://4100.api.green-api.com:8443',
    'https://4100.api.green-api.com/other',
    'https://4100.api.green-api.com?redirect=evil.test',
    'https://4100.api.green-api.com#fragment',
    'не адрес',
  ])('отклоняет небезопасный адрес до запроса: %s', (apiUrl) => {
    const fetchImpl = vi.fn<typeof fetch>()
    expect(() =>
      createGreenApiClient(
        {
          apiUrl,
          idInstance: crypto.randomUUID(),
          apiTokenInstance: crypto.randomUUID(),
        },
        fetchImpl,
      ),
    ).toThrow('Укажите HTTPS-адрес API инстанса на домене GREEN-API.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    'https://api.green-api.com',
    'https://3100.api.green-api.com',
    'https://4100.api.green-api.com/',
    'https://7107.api.greenapi.com',
  ])('принимает официальный адрес: %s', async (apiUrl) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ stateInstance: 'authorized' })),
      )
    const client = createGreenApiClient(
      {
        apiUrl,
        idInstance: crypto.randomUUID(),
        apiTokenInstance: crypto.randomUUID(),
      },
      fetchImpl,
    )
    expect(await client.getStateInstance()).toBe('authorized')
  })
})
