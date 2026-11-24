import { useCallback, useEffect, useRef, useState } from 'react'

export class ApiError extends Error {}

export async function call<T = unknown>(method: string, args?: unknown): Promise<T> {
  const r = await window.zaion.call(method, args)
  if (!r.ok) throw new ApiError(r.error)
  return r.data as T
}

/** Carrega dados e recarrega em eventos do motor (tick/settings). */
export function useQuery<T>(method: string, args?: unknown, opts: { live?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const key = JSON.stringify(args ?? null)
  const argsRef = useRef(args)
  argsRef.current = args

  const reload = useCallback(async () => {
    try {
      const d = await call<T>(method, argsRef.current)
      setData(d)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [method])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [reload, key])

  useEffect(() => {
    if (!opts.live) return
    return window.zaion.onEvent(() => void reload())
  }, [opts.live, reload])

  return { data, error, loading, reload, setData }
}
