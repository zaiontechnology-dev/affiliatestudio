import { contextBridge, ipcRenderer } from 'electron'

/**
 * Ponte mínima e restrita entre interface e processo principal.
 * Nenhuma API do Node/Electron é exposta diretamente ao renderer.
 */
const api = {
  call: (method: string, args?: unknown) => ipcRenderer.invoke('zaion:call', method, args),
  onEvent: (cb: (e: { type: string; payload?: unknown }) => void) => {
    const listener = (_: unknown, e: { type: string; payload?: unknown }) => cb(e)
    ipcRenderer.on('zaion:event', listener)
    return () => {
      ipcRenderer.removeListener('zaion:event', listener)
    }
  }
}

contextBridge.exposeInMainWorld('zaion', api)
