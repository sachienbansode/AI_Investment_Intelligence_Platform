import { Component } from 'react'

// Top-level safety net: if any component throws during render, show a friendly
// message instead of a blank white screen.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('App error:', error, info)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif', color: '#181d27', background: '#fbf7f3' }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>{String.fromCharCode(0x26A0)}</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>Something went wrong</h2>
          <p style={{ color: '#6b7280', lineHeight: 1.6, margin: '0 0 18px' }}>
            The app hit an unexpected error. Reloading usually fixes it. If it keeps happening, please contact support.
          </p>
          <button onClick={() => window.location.reload()}
            style={{ background: 'linear-gradient(90deg,#FF8A3D,#F94C00)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
            Reload
          </button>
          <div style={{ marginTop: 14 }}>
            <button onClick={() => { try { sessionStorage.clear() } catch {} window.location.reload() }}
              style={{ background: 'transparent', border: '1px solid #ecdfd2', color: '#6b7280', borderRadius: 10, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>
              Sign out and reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
