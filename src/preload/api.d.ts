export {}

declare global {
  interface Window {
    zaion: {
      call: (method: string, args?: unknown) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>
      onEvent: (cb: (e: { type: string; payload?: unknown }) => void) => () => void
    }
  }
}
