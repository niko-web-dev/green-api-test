const formatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})
export const formatTime = (timestamp: number) =>
  formatter.format(new Date(timestamp * 1000))
