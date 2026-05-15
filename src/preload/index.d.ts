import { ElectronAPI } from '@electron-toolkit/preload'

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

interface SerialConsoleApi {
  bootstrap: () => Promise<SerialConsoleBootstrap>
  listPorts: () => Promise<SerialPortInfo[]>
  connect: (payload: { path: string; baudRate: number }) => Promise<void>
  disconnect: () => Promise<void>
  send: (payload: { text: string }) => Promise<void>
  clear: () => Promise<void>
  onEntry: (callback: (entry: SerialConsoleEntry) => void) => () => void
  onStatus: (callback: (status: SerialConsoleStatus) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      serialConsole: SerialConsoleApi
    }
  }
}
