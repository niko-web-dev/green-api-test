export function maskInstance(id: string): string {
  return id.length > 6 ? `${id.slice(0, 4)}••••${id.slice(-2)}` : '••••'
}
