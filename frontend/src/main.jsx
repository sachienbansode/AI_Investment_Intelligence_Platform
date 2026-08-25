import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import PublicShare from './components/PublicShare.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initNative } from './native.js'
import './styles.css'

initNative()

// Public, no-login shared-answer page at /s/<token>; everything else is the app.
const share = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)/)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><ErrorBoundary>
    {share ? <PublicShare token={share[1]} /> : <App />}
  </ErrorBoundary></React.StrictMode>
)
