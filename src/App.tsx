import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>(
    'checking',
  )

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Health check failed')
        }

        const result = (await response.json()) as { ok: boolean }
        setApiStatus(result.ok ? 'ok' : 'error')
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setApiStatus('error')
        }
      })

    return () => controller.abort()
  }, [])

  return (
    <main className="app-shell">
      <p className="eyebrow">Football · Basketball · Baseball trivia</p>
      <h1>Streaking Sports</h1>
      <p className="tagline">No rulebook when you're streaking.</p>
      <p className={`api-status api-status--${apiStatus}`} role="status">
        API status: {apiStatus}
      </p>
    </main>
  )
}

export default App
