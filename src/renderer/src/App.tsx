import { useEffect, useRef, useState } from 'react'

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

function App(): React.JSX.Element {
  const [entries, setEntries] = useState<SerialConsoleEntry[]>([])
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [status, setStatus] = useState<SerialConsoleStatus>({
    connected: false,
    portPath: null,
    baudRate: 115200
  })
  const [portPath, setPortPath] = useState('')
  const [baudRate, setBaudRate] = useState('115200')
  const [baudRatePresets, setBaudRatePresets] = useState<number[]>([])
  const [txInput, setTxInput] = useState('')
  const [lineEnding, setLineEnding] = useState<'none' | 'lf' | 'crlf'>('lf')
  const [isBusy, setIsBusy] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let isMounted = true

    window.api.serialConsole.bootstrap().then((payload) => {
      if (!isMounted) return
      setEntries(payload.entries)
      setPorts(payload.ports)
      setStatus(payload.status)
      setPortPath(payload.status.portPath ?? payload.ports[0]?.path ?? '')
      setBaudRate(String(payload.status.baudRate))
      setBaudRatePresets(payload.baudRatePresets)
    })

    const unsubscribeEntry = window.api.serialConsole.onEntry((entry) => {
      setEntries((currentEntries) => [...currentEntries, entry])
    })

    const unsubscribeStatus = window.api.serialConsole.onStatus((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus.portPath) {
        setPortPath(nextStatus.portPath)
      }
      setBaudRate(String(nextStatus.baudRate))
    })

    return () => {
      isMounted = false
      unsubscribeEntry()
      unsubscribeStatus()
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) return

    viewport.scrollTop = viewport.scrollHeight
  }, [entries])

  const refreshPorts = async (): Promise<void> => {
    setIsBusy(true)

    try {
      const nextPorts = await window.api.serialConsole.listPorts()
      setPorts(nextPorts)
      setPortPath((currentPortPath) => {
        if (currentPortPath && nextPorts.some((port) => port.path === currentPortPath)) {
          return currentPortPath
        }

        return nextPorts[0]?.path ?? ''
      })
    } finally {
      setIsBusy(false)
    }
  }

  const connect = async (): Promise<void> => {
    const nextBaudRate = Number(baudRate)

    if (!portPath || !Number.isFinite(nextBaudRate) || nextBaudRate <= 0) return

    setIsBusy(true)

    try {
      await window.api.serialConsole.connect({ path: portPath, baudRate: nextBaudRate })
    } finally {
      setIsBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    setIsBusy(true)

    try {
      await window.api.serialConsole.disconnect()
    } finally {
      setIsBusy(false)
    }
  }

  const send = async (): Promise<void> => {
    if (!status.connected || txInput.length === 0) return

    const suffix = lineEnding === 'lf' ? '\n' : lineEnding === 'crlf' ? '\r\n' : ''
    const payload = `${txInput}${suffix}`

    setIsBusy(true)

    try {
      await window.api.serialConsole.send({ text: payload })
      setTxInput('')
    } finally {
      setIsBusy(false)
    }
  }

  const clearConsole = async (): Promise<void> => {
    setEntries([])
    await window.api.serialConsole.clear()
  }

  const isConnected = status.connected

  return (
    <main className="debug-console-shell">
      <section className="debug-console-panel">
        <header className="debug-console-header">
          <div>
            <p className="eyebrow">Serial Monitor</p>
            <h1>Serial Debug Console</h1>
            <p className="subtitle">
              用來監看 serial 裝置的 RX/TX 資料流，適合 MCU、模組板與 CLI 裝置調試。
            </p>
          </div>
          <div className="toolbar">
            <span className={`status-pill ${isConnected ? 'running' : 'idle'}`}>
              {isConnected ? `Connected ${status.portPath}` : 'Disconnected'}
            </span>
            <button className="ghost-button" onClick={() => void clearConsole()} type="button">
              Clear
            </button>
          </div>
        </header>

        <section className="control-strip" aria-label="Serial controls">
          <label className="field-group">
            <span>Port</span>
            <select
              className="console-select"
              value={portPath}
              onChange={(event) => setPortPath(event.target.value)}
              disabled={isBusy || isConnected}
            >
              <option value="">Select a serial port</option>
              {ports.map((port) => (
                <option key={port.path} value={port.path}>
                  {port.friendlyName}
                </option>
              ))}
            </select>
          </label>

          <label className="field-group field-group-narrow">
            <span>Baud</span>
            <input
              className="console-input compact"
              value={baudRate}
              inputMode="numeric"
              onChange={(event) => setBaudRate(event.target.value)}
              disabled={isBusy || isConnected}
            />
          </label>

          <div className="preset-strip" aria-label="Baud presets">
            {baudRatePresets.map((preset) => (
              <button
                key={preset}
                className={`hint-chip ${baudRate === String(preset) ? 'active' : ''}`}
                type="button"
                onClick={() => setBaudRate(String(preset))}
                disabled={isBusy || isConnected}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="control-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => void refreshPorts()}
              disabled={isBusy}
            >
              Refresh Ports
            </button>
            {isConnected ? (
              <button
                className="disconnect-button"
                type="button"
                onClick={() => void disconnect()}
                disabled={isBusy}
              >
                Disconnect
              </button>
            ) : (
              <button
                className="run-button"
                type="button"
                onClick={() => void connect()}
                disabled={isBusy || !portPath}
              >
                Connect
              </button>
            )}
          </div>
        </section>

        <section className="console-viewport" ref={viewportRef} aria-label="Console output">
          {entries.length === 0 ? (
            <div className="empty-state">
              <p>No serial traffic yet.</p>
              <p>Refresh ports, connect to a COM device, then send text to start monitoring.</p>
            </div>
          ) : (
            entries.map((entry) => (
              <article key={entry.id} className={`console-row ${entry.level}`}>
                <span className="console-time">{entry.timestamp}</span>
                <span className="console-scope">{entry.level}</span>
                <span className="console-marker">
                  {entry.level === 'tx' ? '>' : entry.level === 'rx' ? '<' : ''}
                </span>
                <pre className="console-text">{entry.text}</pre>
              </article>
            ))
          )}
        </section>

        <form
          className="console-input-bar"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <label className="prompt-label" htmlFor="debug-console-input">
            &gt;
          </label>
          <input
            id="debug-console-input"
            className="console-input"
            autoComplete="off"
            spellCheck={false}
            value={txInput}
            placeholder={
              isConnected ? 'Send text to the serial device' : 'Connect to a serial port first'
            }
            onChange={(event) => setTxInput(event.target.value)}
            disabled={isBusy || !isConnected}
          />
          <select
            className="console-select line-ending-select"
            value={lineEnding}
            onChange={(event) => setLineEnding(event.target.value as 'none' | 'lf' | 'crlf')}
            disabled={isBusy || !isConnected}
          >
            <option value="none">No line ending</option>
            <option value="lf">LF</option>
            <option value="crlf">CRLF</option>
          </select>
          <button
            className="run-button"
            type="submit"
            disabled={isBusy || !isConnected || txInput.length === 0}
          >
            Send
          </button>
        </form>
      </section>
    </main>
  )
}

export default App
