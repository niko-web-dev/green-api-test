import { useState } from 'react'
import type { FormEvent } from 'react'
import { MESSENGERS } from '../messengers'
import type { MessengerId } from '../messengers'
import { useAppDispatch, useAppSelector } from '../store'
import { selectSession } from '../store/sessionSlice'
import { login } from '../store/thunks'
import Icon from './Icon'
import styles from './LoginScreen.module.css'

export default function LoginScreen() {
  const dispatch = useAppDispatch()
  const session = useAppSelector(selectSession)
  const [messenger, setMessenger] = useState<MessengerId>('max')
  const [apiUrl, setApiUrl] = useState(MESSENGERS.max.defaultApiUrl)
  const [idInstance, setIdInstance] = useState('')
  const [apiTokenInstance, setToken] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  const pending = session.loginRequestId !== null
  function choose(id: MessengerId) {
    setMessenger(id)
    setApiUrl(MESSENGERS[id].defaultApiUrl)
    setIdInstance('')
    setToken('')
    setInvalid(null)
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    if (!/^\d+$/.test(idInstance.trim()) || !apiTokenInstance.trim()) {
      setInvalid('Укажите ID инстанса цифрами и токен из личного кабинета.')
      return
    }
    setInvalid(null)
    void dispatch(
      login({
        messenger,
        sessionId: session.sessionId,
        credentials: {
          apiUrl: apiUrl.trim(),
          idInstance: idInstance.trim(),
          apiTokenInstance: apiTokenInstance.trim(),
        },
      }),
    )
  }
  return (
    <main className={styles.page}>
      <div className={styles.brand}>
        <span className={styles.mark}>
          <Icon name="chat" />
        </span>{' '}
        GREEN-API <span className={styles.brandNote}>/ ЧАТ</span>
      </div>
      <section className={styles.card} aria-labelledby="login-title">
        <h1 id="login-title">Подключите мессенджер</h1>
        <form onSubmit={submit}>
          <fieldset className={styles.segments} disabled={pending}>
            <legend className="srOnly">Мессенджер</legend>
            {(Object.keys(MESSENGERS) as MessengerId[]).map((id) => (
              <button
                type="button"
                key={id}
                aria-pressed={id === messenger}
                onClick={() => choose(id)}
                className={id === messenger ? styles.selected : ''}
              >
                {MESSENGERS[id].title}
              </button>
            ))}
          </fieldset>
          <fieldset className={styles.fields} disabled={pending}>
            <legend className="srOnly">Учётные данные</legend>
            <label htmlFor="api-url">API URL</label>
            <input
              id="api-url"
              type="url"
              required
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              autoComplete="off"
              aria-describedby="api-hint"
            />
            <small id="api-hint">
              Укажите адрес API вашего инстанса из кабинета.
            </small>
            <label htmlFor="instance-id">ID инстанса</label>
            <input
              id="instance-id"
              required
              inputMode="numeric"
              value={idInstance}
              onChange={(e) => setIdInstance(e.target.value)}
              autoComplete="off"
              placeholder="Введите idInstance"
            />
            <label htmlFor="instance-token">API токен</label>
            <input
              id="instance-token"
              type="password"
              required
              value={apiTokenInstance}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              placeholder="Введите apiTokenInstance"
            />
          </fieldset>
          <div aria-live="polite">
            {(invalid || session.error) && (
              <p className="notice error">{invalid || session.error}</p>
            )}
          </div>
          <button className={styles.submit} disabled={pending}>
            {pending ? 'Подключаемся…' : 'Войти'}
            <span aria-hidden="true">→</span>
          </button>
        </form>
        <p className={styles.help}>
          Данные для входа — в{' '}
          <a
            href="https://console.green-api.com/"
            target="_blank"
            rel="noreferrer"
          >
            личном кабинете GREEN-API ↗
          </a>
        </p>
      </section>
      <p className={styles.footnote}>
        Только текст. Только разговор.
        <br />
        Данные входа сохраняются в этой вкладке до выхода.
      </p>
    </main>
  )
}
