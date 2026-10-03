import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Относительный base: сборка работает на GitHub Pages из подкаталога
  // без роутера и без привязки к имени репозитория.
  base: './',
  test: {
    environment: mode === 'live' ? 'node' : 'jsdom',
    // Подсказка об ответе должна появляться до завершения двухминутного ожидания.
    disableConsoleIntercept: mode === 'live',
    exclude:
      mode === 'live'
        ? configDefaults.exclude
        : [...configDefaults.exclude, 'src/live/**'],
    setupFiles: mode === 'live' ? [] : ['./src/test/setup.ts'],
  },
}))
