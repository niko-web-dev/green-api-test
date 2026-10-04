export type LockRequest = {
  callback: (lock: Lock | null) => Promise<void>
  resolve: () => void
  reject: (reason: unknown) => void
  signal?: AbortSignal
  abort: () => void
}
