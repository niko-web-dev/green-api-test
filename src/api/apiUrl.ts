export function normalizeApiUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    // Токен передаётся в пути: даже первый запрос не должен уходить на посторонний сервер.
    if (
      url.protocol !== 'https:' ||
      !/^(?:\d+\.api|api)\.(?:green-api|greenapi)\.com$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/*$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      return null
    return url.origin
  } catch {
    return null
  }
}
