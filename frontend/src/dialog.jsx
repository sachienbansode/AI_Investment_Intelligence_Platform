// App-wide themed dialogs that replace the browser's native confirm/alert/prompt.
// Usage:  if (!(await confirmDialog('Delete X?', { danger: true })) return
//         await alertDialog('Saved.')
//         const name = await promptDialog('New name', { value: 'old' })  // null on cancel
// Mount <DialogHost /> once at the app root.
import { useEffect, useRef, useState } from 'react'

let _emit = null
let _seq = 0
const _pending = []

function request(opts) {
  return new Promise(resolve => {
    const item = { id: ++_seq, resolve, ...opts }
    if (_emit) _emit(item)
    else _pending.push(item)
  })
}

export function confirmDialog(message, opts = {}) {
  return request({ kind: 'confirm', message, title: 'Please confirm',
    confirmText: 'OK', cancelText: 'Cancel', ...opts })
}
export function alertDialog(message, opts = {}) {
  return request({ kind: 'alert', message, title: 'Notice', confirmText: 'OK', ...opts })
}
export function promptDialog(message, opts = {}) {
  return request({ kind: 'prompt', message, title: message, confirmText: 'OK',
    cancelText: 'Cancel', value: '', placeholder: '', ...opts })
}

export function DialogHost() {
  const [cur, setCur] = useState(null)
  const [text, setText] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    _emit = item => { setText(item.value || ''); setCur(item) }
    while (_pending.length) { const i = _pending.shift(); setText(i.value || ''); setCur(i) }
    return () => { _emit = null }
  }, [])

  useEffect(() => {
    if (cur?.kind === 'prompt') setTimeout(() => inputRef.current?.focus(), 30)
  }, [cur])

  if (!cur) return null

  const finish = val => { cur.resolve(val); setCur(null) }
  const onCancel = () => finish(cur.kind === 'alert' ? true : (cur.kind === 'prompt' ? null : false))
  const onOk = () => finish(cur.kind === 'prompt' ? text : true)

  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    else if (e.key === 'Enter' && cur.kind !== 'prompt') { e.preventDefault(); onOk() }
  }

  return (
    <div className="modal-overlay" onClick={onCancel} onKeyDown={onKey}>
      <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h4 className="modal-title">{cur.title}</h4>
        {cur.kind !== 'prompt' && <p className="modal-msg">{cur.message}</p>}
        {cur.kind === 'prompt' && (
          <input ref={inputRef} className="modal-input" value={text}
                 placeholder={cur.placeholder}
                 onChange={e => setText(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onOk() } }} />
        )}
        <div className="modal-actions">
          {cur.kind !== 'alert' && (
            <button className="ghost" onClick={onCancel}>{cur.cancelText}</button>
          )}
          <button className={cur.danger ? 'danger' : ''} onClick={onOk}>{cur.confirmText}</button>
        </div>
      </div>
    </div>
  )
}


// ── Toasts ──────────────────────────────────────────────────────────────────
// Lightweight, scroll-independent confirmations. toast('Saved') / toast(msg,
// { type: 'error' }). Mount <ToastHost /> once at the app root.
let _toastEmit = null
let _tseq = 0
const _toastPending = []

export function toast(message, { type = 'success', duration = 3500 } = {}) {
  const item = { id: ++_tseq, message, type, duration }
  if (_toastEmit) _toastEmit(item)
  else _toastPending.push(item)
}

export function ToastHost() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const push = item => {
      setItems(x => [...x, item])
      setTimeout(() => setItems(x => x.filter(i => i.id !== item.id)), item.duration)
    }
    _toastEmit = push
    while (_toastPending.length) push(_toastPending.shift())
    return () => { _toastEmit = null }
  }, [])
  const dismiss = id => setItems(x => x.filter(i => i.id !== id))
  if (!items.length) return null
  return (
    <div className="toast-host">
      {items.map(t => (
        <div key={t.id} className={'toast toast-' + t.type} onClick={() => dismiss(t.id)} role="status">
          <span className="toast-icon">{t.type === 'error' ? String.fromCharCode(0x21) : String.fromCharCode(0x2713)}</span>
          <span className="toast-msg">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
