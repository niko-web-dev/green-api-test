import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App.tsx'

test('показывает заголовок приложения', () => {
  render(<App />)

  expect(
    screen.getByRole('heading', { name: 'Подключите мессенджер' }),
  ).toBeInTheDocument()
})
