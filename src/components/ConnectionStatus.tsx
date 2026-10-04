import { useAppSelector } from '../store'
import styles from './ConnectionStatus.module.css'
import type { ConnectionStatusProps } from './types'

const labels = {
  idle: 'Подключаемся',
  online: 'На связи',
  reconnecting: 'Переподключение',
  error: 'Ошибка соединения',
  standby: 'В другой вкладке',
}

export default function ConnectionStatus({
  className = '',
}: ConnectionStatusProps) {
  const connection = useAppSelector((state) => state.session.connection)
  return (
    <p className={`${styles.status} ${className}`} role="status">
      <i className={styles.dot} data-state={connection} aria-hidden="true" />
      {labels[connection]}
    </p>
  )
}
