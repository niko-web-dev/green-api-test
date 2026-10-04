import type { Message } from '../store/chatsSlice'
import { useAppDispatch, useAppSelector } from '../store'
import { selectSessionId } from '../store/sessionSlice'
import { retrySend } from '../store/thunks'
import { formatTime } from './formatTime'
import styles from './ChatWindow.module.css'

const labels = {
  sending: 'Отправляется',
  sent: 'Принято API, доставка не подтверждена',
  failed: 'Не отправлено',
  unknown: 'Отправка не подтверждена',
}
const symbols = { sending: '◷', sent: '✓', failed: '!', unknown: '!' }
export default function MessageBubble({ message }: { message: Message }) {
  const dispatch = useAppDispatch()
  const sessionId = useAppSelector(selectSessionId)
  const outgoing = message.direction === 'out'
  const retryable = outgoing && ['failed', 'unknown'].includes(message.status)
  return (
    <li
      className={`${styles.bubble} ${outgoing ? styles.outgoing : styles.incoming}`}
    >
      <p>{message.text}</p>
      <div className={styles.meta}>
        <time dateTime={new Date(message.timestamp * 1000).toISOString()}>
          {formatTime(message.timestamp)}
        </time>
        {outgoing && (
          <span
            aria-label={labels[message.status]}
            title={labels[message.status]}
          >
            {symbols[message.status]}
          </span>
        )}
      </div>
      {retryable && (
        <div className={styles.failure}>
          <p>{message.error ?? labels[message.status]}</p>
          {message.status === 'unknown' && (
            <p>Повтор может создать дубликат.</p>
          )}
          <button
            onClick={() =>
              void dispatch(retrySend({ sessionId, key: message.key }))
            }
          >
            Повторить
          </button>
        </div>
      )}
    </li>
  )
}
