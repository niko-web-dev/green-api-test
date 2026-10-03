# Примеры ответов GREEN-API

`*.live.*.json` — реальные обезличенные ответы.
`*.docs.*.json` — примеры документации, не доказательство работы сервиса.

| Файлы                            | Источник                                                                                                                                                                                                                                                                                                                                                                             | Дата       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `telegram.live.*.json`           | Telegram, реальные ответы                                                                                                                                                                                                                                                                                                                                                            | 02.10.2026 |
| `whatsapp.live.*.json`           | WhatsApp, реальные ответы                                                                                                                                                                                                                                                                                                                                                            | 03.10.2026 |
| `max.docs.*.json` (кроме цитаты) | [CheckAccount](https://green-api.com/v3/docs/api/service/CheckAccount/), [SendMessage](https://green-api.com/v3/docs/api/sending/SendMessage/), [текст](https://green-api.com/v3/docs/api/receiving/notifications-format/incoming-message/TextMessage/), [расширенный текст](https://green-api.com/v3/docs/api/receiving/notifications-format/incoming-message/ExtendedTextMessage/) | 02.10.2026 |
| `max.docs.incoming-quoted.json`  | [QuotedMessage](https://green-api.com/v3/docs/api/receiving/notifications-format/incoming-message/QuotedMessage/)                                                                                                                                                                                                                                                                    | 03.10.2026 |

Получатель заменён на `10000002` / `79990000002@c.us`, отправитель — на `10000001` / `79990000001@c.us`; имена и идентификаторы обезличены, связи по `idMessage` сохранены.

- Уведомления live содержат обёртку `{ receiptId, body }`, MAX docs — только тело.
- Пустая очередь — JSON `null` с HTTP 200.
- В Telegram ссылка пришла как `textMessage`.
- `checkWhatsapp` вернул `@lid`, уведомления используют `@c.us` при `enableLidMode: "no"`.
- MAX вживую не проверен.
