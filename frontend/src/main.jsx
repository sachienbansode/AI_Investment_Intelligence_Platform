import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initNative } from './native.js'
import './styles.css'

initNative()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
