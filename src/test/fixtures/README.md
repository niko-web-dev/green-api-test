# Примеры ответов GREEN-API

- `*.live.*.json` — реальные обезличенные ответы, полученные из браузера 02.10.2026.
- `*.docs.*.json` — примеры документации; они не доказывают работу сервиса.

## Telegram: живая проверка

На `https://4100.api.green-api.com` из `http://localhost:5173` успешно выполнены
GET получения, POST проверки/отправки и DELETE подтверждения. Инстанс авторизован,
`webhookUrl` пустой; `incomingWebhook`, `outgoingWebhook`, `outgoingAPIMessageWebhook`
включены. Ответы сохранённых методов имели HTTP 200. Общий host не проверялся.

Ответы проверки и отправки сохранены как тела ответа. Уведомления сохранены с
обёрткой `{ receiptId, body }`, как их возвращает `receiveNotification`.
`telegram.live.receive-empty.json` содержит JSON `null`: HTTP 200, не пустое тело.

Обычный ответ «принято» и ссылка `https://example.com` пришли как `textMessage`.
Поэтому ссылка сохранена в `incoming-text-link`, а не в `incoming-extended-text`.
Реального `extendedTextMessage` в тестовом диалоге не получено.
Статусы `delivered` и `read` имеют `sendByApi: true` и относятся к сохранённой
отправке. Старые статусы, группы и каналы не включены.

Телефоны, имена, идентификаторы аккаунтов и сообщений заменены последовательно.
Сохранены связи: получатель `10000002`, отправитель `10000001`; одинаковый
`idMessage` в ответе отправки, исходящем уведомлении и его статусах.
Замаскированный идентификатор инстанса заменён на условный числовой идентификатор.
Текст исходящего тестового сообщения заменён на «Тестовое сообщение».

## MAX: документация

Уведомления MAX сохранены без обёртки очереди: источник содержит тела webhook.
Контактные данные в примерах заменены, структура сохранена.

Источники, проверенные 02.10.2026:

- [CheckAccount](https://green-api.com/v3/docs/api/service/CheckAccount/)
- [SendMessage](https://green-api.com/v3/docs/api/sending/SendMessage/)
- [Входящий текст](https://green-api.com/v3/docs/api/receiving/notifications-format/incoming-message/TextMessage/)
- [Расширенный текст](https://green-api.com/v3/docs/api/receiving/notifications-format/incoming-message/ExtendedTextMessage/)

MAX и WhatsApp вживую не проверены. Лимит числа чатов и ошибки при его превышении
не проверялись: дополнительные диалоги ради исчерпания квоты не создавались.
