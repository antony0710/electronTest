import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type SerialConsoleLevel = 'system' | 'rx' | 'tx' | 'error'

interface SerialConsoleEntry {
  id: string
  level: SerialConsoleLevel
  text: string
  timestamp: string
}

interface SerialPortInfo {
  path: string
  manufacturer?: string
  friendlyName: string
}

interface SerialConsoleStatus {
  connected: boolean
  portPath: string | null
  baudRate: number
}

interface SerialConsoleBootstrap {
  entries: SerialConsoleEntry[]
  ports: SerialPortInfo[]
  status: SerialConsoleStatus
  baudRatePresets: number[]
}

const SERIAL_CONSOLE_ENTRY = 'serial-console:entry'
const SERIAL_CONSOLE_BOOTSTRAP = 'serial-console:bootstrap'
const SERIAL_CONSOLE_CLEAR = 'serial-console:clear'
const SERIAL_CONSOLE_STATUS = 'serial-console:status'
const SERIAL_CONSOLE_LIST_PORTS = 'serial-console:list-ports'
const SERIAL_CONSOLE_CONNECT = 'serial-console:connect'
const SERIAL_CONSOLE_DISCONNECT = 'serial-console:disconnect'
const SERIAL_CONSOLE_SEND = 'serial-console:send'

// Custom APIs for renderer
const api = {
  serialConsole: {
    bootstrap: (): Promise<SerialConsoleBootstrap> =>
      electronAPI.ipcRenderer.invoke(SERIAL_CONSOLE_BOOTSTRAP),
    listPorts: (): Promise<SerialPortInfo[]> =>
      electronAPI.ipcRenderer.invoke(SERIAL_CONSOLE_LIST_PORTS),
    connect: (payload: { path: string; baudRate: number }): Promise<void> =>
      electronAPI.ipcRenderer.invoke(SERIAL_CONSOLE_CONNECT, payload),
    disconnect: (): Promise<void> => electronAPI.ipcRenderer.invoke(SERIAL_CONSOLE_DISCONNECT),
    send: (payload: { text: string }): Promise<void> =>
      electronAPI.ipcRenderer.invoke(SERIAL_CONSOLE_SEND, payload),
    clear: (): Promise<void> => electronAPI.ipcRenderer.invoke(SERIAL_CONSOLE_CLEAR),
    onEntry: (callback: (entry: SerialConsoleEntry) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: SerialConsoleEntry): void => {
        callback(entry)
      }

      electronAPI.ipcRenderer.on(SERIAL_CONSOLE_ENTRY, listener)

      return () => {
        electronAPI.ipcRenderer.removeListener(SERIAL_CONSOLE_ENTRY, listener)
      }
    },
    onStatus: (callback: (status: SerialConsoleStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: SerialConsoleStatus): void => {
        callback(status)
      }

      electronAPI.ipcRenderer.on(SERIAL_CONSOLE_STATUS, listener)

      return () => {
        electronAPI.ipcRenderer.removeListener(SERIAL_CONSOLE_STATUS, listener)
      }
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
