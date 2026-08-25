// Public (no-login) view of a shared assistant answer. Self-contained: renders the
// Q&A with branding, the app intro + URL call-to-action, and the compliance
// disclaimer. Charts aren't rendered here (they need live data / login) — instead
// we invite the reader into the app.
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'

export default function PublicShare({ token }) {
  const [d, setD] = useState(undefined)   // undefined=loading, null=not found
  useEffect(() => {
    api.shareGet(token).then(setD).catch(() => setD(null))
  }, [token])

  const RS = String.fromCharCode(0x20B9)
  const appUrl = (d && d.url) || 'https://dev-invest.niytri.com'

  return (
    <div className="ps-page">
      <header className="ps-top">
        <a className="ps-brand" href={appUrl}>
          <span className="ps-mark">{RS}</span>
          <b>{(d && d.platform_label) || 'NIYTRI Investment Intelligence'}</b>
        </a>
        <a className="ps-cta" href={appUrl}>Open the app</a>
      </header>

      <main className="ps-main">
        {d === undefined && <p className="hint">Loading shared answer…</p>}
        {d === null && (
          <div className="ps-card">
            <h2>Link unavailable</h2>
            <p className="hint">This shared answer has expired or doesn’t exist.</p>
            <a className="ps-cta" href={appUrl}>Explore NIYTRI Investment Intelligence</a>
          </div>
        )}
        {d && d !== null && (
          <div className="ps-card">
            <p className="ps-intro">{d.intro}</p>
            {d.question && <div className="ps-q"><span>Question</span><p>{d.question}</p></div>}
            <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(d.answer || '') }} />
            <div className="ps-actions">
              <a className="ps-cta" href={appUrl}>Get your own AI insights on Indian stocks</a>
            </div>
            <p className="ps-disc">{d.disclaimer}</p>
          </div>
        )}
      </main>

      <footer className="ps-foot">
        <a href={appUrl}>{appUrl.replace(/^https?:\/\//, '')}</a> · AI-generated market intelligence · not investment advice
      </footer>
    </div>
  )
}
