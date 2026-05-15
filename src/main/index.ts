import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { SerialPort } from 'serialport'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

type SerialConsoleLevel = 'system' | 'rx' | 'tx' | 'error'

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

interface SerialConsoleEntry {
  id: string
  level: SerialConsoleLevel
  text: string
  timestamp: string
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
const serialHistory: SerialConsoleEntry[] = []
const SERIAL_HISTORY_LIMIT = 600
const BAUD_RATE_PRESETS = [9600, 19200, 38400, 57600, 115200, 230400]

let currentPort: SerialPort | null = null
let connectionStatus: SerialConsoleStatus = {
  connected: false,
  portPath: null,
  baudRate: 115200
}

function createSerialEntry(level: SerialConsoleLevel, text: string): SerialConsoleEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    text,
    timestamp: new Date().toLocaleTimeString()
  }
}

function publishSerialEntry(entry: SerialConsoleEntry): void {
  serialHistory.push(entry)

  if (serialHistory.length > SERIAL_HISTORY_LIMIT) {
    serialHistory.splice(0, serialHistory.length - SERIAL_HISTORY_LIMIT)
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SERIAL_CONSOLE_ENTRY, entry)
  }
}

function publishStatus(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SERIAL_CONSOLE_STATUS, connectionStatus)
  }
}

function describePort(port: Awaited<ReturnType<typeof SerialPort.list>>[number]): SerialPortInfo {
  const detail = [port.manufacturer, port.serialNumber].filter(Boolean).join(' / ')

  return {
    path: port.path,
    manufacturer: port.manufacturer,
    friendlyName: detail ? `${port.path} - ${detail}` : port.path
  }
}

async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list()
  return ports.map(describePort)
}

async function getSerialConsoleBootstrap(): Promise<SerialConsoleBootstrap> {
  return {
    entries: [...serialHistory],
    ports: await listSerialPorts(),
    status: connectionStatus,
    baudRatePresets: BAUD_RATE_PRESETS
  }
}

async function disconnectSerialPort(reason?: string): Promise<void> {
  if (!currentPort) {
    connectionStatus = {
      ...connectionStatus,
      connected: false,
      portPath: null
    }
    publishStatus()
    return
  }

  const portToClose = currentPort
  currentPort = null

  try {
    if (portToClose.isOpen) {
      await new Promise<void>((resolve, reject) => {
        portToClose.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publishSerialEntry(createSerialEntry('error', `Disconnect failed: ${message}`))
  }

  connectionStatus = {
    ...connectionStatus,
    connected: false,
    portPath: null
  }
  publishStatus()

  if (reason) {
    publishSerialEntry(createSerialEntry('system', reason))
  }
}

async function connectSerialPort(portPath: string, baudRate: number): Promise<void> {
  const nextPortPath = portPath.trim()

  if (!nextPortPath) {
    throw new Error('Port path is required.')
  }

  if (!Number.isFinite(baudRate) || baudRate <= 0) {
    throw new Error('Baud rate must be a positive number.')
  }

  if (currentPort && connectionStatus.portPath === nextPortPath && currentPort.isOpen) {
    return
  }

  await disconnectSerialPort()

  const port = new SerialPort({
    path: nextPortPath,
    baudRate,
    autoOpen: false
  })

  port.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').replace(/\r/g, '\\r').replace(/\n/g, '\\n\n')
    publishSerialEntry(createSerialEntry('rx', text))
  })

  port.on('error', (error) => {
    publishSerialEntry(createSerialEntry('error', error.message))
  })

  port.on('close', () => {
    if (currentPort === port) {
      void disconnectSerialPort(`Disconnected from ${nextPortPath}.`)
    }
  })

  await new Promise<void>((resolve, reject) => {
    port.open((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

  currentPort = port
  connectionStatus = {
    connected: true,
    portPath: nextPortPath,
    baudRate
  }
  publishStatus()
  publishSerialEntry(
    createSerialEntry('system', `Connected to ${nextPortPath} @ ${baudRate} baud.`)
  )
}

async function sendSerialData(payload: string): Promise<void> {
  if (!currentPort || !currentPort.isOpen || !connectionStatus.portPath) {
    throw new Error('No serial port connected.')
  }

  await new Promise<void>((resolve, reject) => {
    currentPort?.write(payload, (error) => {
      if (error) {
        reject(error)
        return
      }

      currentPort?.drain((drainError) => {
        if (drainError) {
          reject(drainError)
          return
        }

        resolve()
      })
    })
  })

  publishSerialEntry(createSerialEntry('tx', payload.replace(/\r/g, '\\r').replace(/\n/g, '\\n\n')))
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle(SERIAL_CONSOLE_BOOTSTRAP, () => getSerialConsoleBootstrap())
  ipcMain.handle(SERIAL_CONSOLE_LIST_PORTS, () => listSerialPorts())
  ipcMain.handle(SERIAL_CONSOLE_CONNECT, (_, payload: { path: string; baudRate: number }) =>
    connectSerialPort(payload.path, payload.baudRate)
  )
  ipcMain.handle(SERIAL_CONSOLE_DISCONNECT, () => disconnectSerialPort('Disconnected by user.'))
  ipcMain.handle(SERIAL_CONSOLE_SEND, (_, payload: { text: string }) =>
    sendSerialData(payload.text)
  )
  ipcMain.handle(SERIAL_CONSOLE_CLEAR, () => {
    serialHistory.length = 0
    publishSerialEntry(createSerialEntry('system', 'Console history cleared.'))
  })

  createWindow()
  publishSerialEntry(
    createSerialEntry(
      'system',
      'Serial debug console ready. Refresh ports, connect to a device, then monitor RX/TX traffic.'
    )
  )

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  void disconnectSerialPort()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
