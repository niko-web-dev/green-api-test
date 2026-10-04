import { describe, expect, it } from 'vitest'
import { createGreenApiError, describeError, isGreenApiError } from './errors'

describe('Ошибки GREEN-API', () => {
  it('сохраняет стандартные свойства ошибки и HTTP-статус', () => {
    const error = createGreenApiError('auth', 401)
    expect(error).toBeInstanceOf(Error)
    expect(isGreenApiError(error)).toBe(true)
    expect(error.name).toBe('GreenApiError')
    expect(error.kind).toBe('auth')
    expect(error.status).toBe(401)
    expect(error.message).toBe(
      'Не удалось авторизоваться. Проверьте учётные данные инстанса.',
    )
    expect(error.stack).toEqual(expect.any(String))
    expect(error.cause).toBeUndefined()
  })

  it('создаёт независимые ошибки без обязательного HTTP-статуса', () => {
    const first = createGreenApiError('network')
    const second = createGreenApiError('network')
    expect(first).not.toBe(second)
    first.message = 'Изменённый текст'
    expect(second.message).not.toBe(first.message)
    expect(first.status).toBeUndefined()
    expect(isGreenApiError(first)).toBe(true)
    expect(isGreenApiError(second)).toBe(true)
  })

  it.each([
    undefined,
    null,
    'network',
    42,
    {},
    { name: 'GreenApiError', kind: 'network' },
    new Error('Ошибка транспорта'),
    Object.assign(new Error('Посторонняя ошибка'), {
      name: 'GreenApiError',
      kind: 'network',
      status: 408,
    }),
  ])('не принимает постороннее значение за ошибку API %#', (value) => {
    expect(isGreenApiError(value)).toBe(false)
    expect(describeError(value, 'Запрос не выполнен.')).toBe(
      'Запрос не выполнен.',
    )
  })

  it('диагностика игнорирует подменённый message', () => {
    const secret = crypto.randomUUID()
    const error = createGreenApiError('badRequest', 400)
    error.message = secret
    expect(describeError(error)).toBe(
      'GREEN-API отклонил запрос. Проверьте переданные данные. (HTTP 400)',
    )
    expect(describeError(new Error(secret))).toBe(
      'Не удалось выполнить запрос к GREEN-API.',
    )
  })

  it('диагностика без HTTP-статуса содержит только безопасный текст', () => {
    const error = createGreenApiError('aborted')
    expect(describeError(error)).toBe('Запрос отменён.')
  })
})
