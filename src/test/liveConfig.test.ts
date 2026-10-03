import { describe, expect, it } from 'vitest'
import { readTelegramConfig } from '../live/config'

function values() {
  return {
    API_URL_TG: 'https://example.com',
    ID_INSTANCE_TG: crypto.randomUUID(),
    API_TOKEN_INSTANCE_TG: crypto.randomUUID(),
    GREEN_API_TEST_PHONE: '79990000002',
  }
}

describe('Настройки живой проверки Telegram', () => {
  it('поддерживает поля локального файла окружения', () => {
    const input = values()
    const config = readTelegramConfig(input)
    expect(config?.credentials).toEqual({
      apiUrl: input.API_URL_TG,
      idInstance: input.ID_INSTANCE_TG,
      apiTokenInstance: input.API_TOKEN_INSTANCE_TG,
    })
    expect(config?.phoneInput).toBe(input.GREEN_API_TEST_PHONE)
  })

  it('явные переменные запуска имеют приоритет', () => {
    const input = values()
    const id = crypto.randomUUID()
    const token = crypto.randomUUID()
    const config = readTelegramConfig({
      ...input,
      GREEN_API_URL: 'https://explicit.example.com',
      GREEN_API_ID: id,
      GREEN_API_TOKEN: token,
    })
    expect(config?.credentials).toEqual({
      apiUrl: 'https://explicit.example.com',
      idInstance: id,
      apiTokenInstance: token,
    })
  })

  it('не разрешает отправку без явного тестового номера', () => {
    expect(
      readTelegramConfig({ ...values(), GREEN_API_TEST_PHONE: undefined }),
    ).toBeNull()
  })

  it.each([
    'API_URL_TG',
    'ID_INSTANCE_TG',
    'API_TOKEN_INSTANCE_TG',
    'GREEN_API_TEST_PHONE',
  ])('не запускает проверку без %s', (key) => {
    expect(readTelegramConfig({ ...values(), [key]: '  ' })).toBeNull()
  })

  it('не подменяет пустую явную переменную сохранёнными данными', () => {
    expect(readTelegramConfig({ ...values(), GREEN_API_TOKEN: '' })).toBeNull()
  })

  it('убирает пробелы вокруг значений', () => {
    const input = values()
    expect(
      readTelegramConfig(
        Object.fromEntries(
          Object.entries(input).map(([key, value]) => [key, ` ${value} `]),
        ),
      ),
    ).toEqual(readTelegramConfig(input))
  })
})
