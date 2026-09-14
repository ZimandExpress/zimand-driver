// PodFiles.jsx — grila de poze + lista de documente, alimentate din coada
// persistentă. Fiecare fișier are propriul status și propriul procent (§17).
//
// Componenta nu ține fișiere în state-ul React: citește din IndexedDB la
// fiecare schimbare anunțată de coadă. Închiderea aplicației nu pierde nimic.

import { useEffect, useState, useMemo } from 'react'
import { t } from '../i18n'
import {
  subscribe, listFiles, removeFile, retryFile, summarize, isOnline,
} from '../offline/uploadQueue'
import { formatBytes } from '../services/imageService'

const NAVY = '#0F2240'
const ORANGE = '#FF7A29'
const GREEN = '#1F7A50'
const RED = '#B23A24'

function useThumbUrl(thumb) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!thumb) { setUrl(null); return }
    const u = URL.createObjectURL(thumb)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [thumb])
  return url
}

function StatusPill({ file, lang }) {
  const s = file.status
  if (s === 'processing') return <span style={pill('#6B7A90')}>⏳</span>
  if (s === 'queued') return <span style={pill('#6B7A90')}>⏳</span>
  if (s === 'uploading') return <span style={pill(ORANGE)}>{file.progress}%</span>
  if (s === 'uploaded' || s === 'confirmed') return <span style={pill(GREEN)}>✓</span>
  if (s === 'failed') return <span style={pill(RED)}>!</span>
  return null
}

const pill = (bg) => ({
  position: 'absolute', right: 4, bottom: 4,
  background: bg, color: '#fff', borderRadius: 20,
  fontSize: 10.5, fontWeight: 700, padding: '2px 6px', lineHeight: 1.3,
  minWidth: 18, textAlign: 'center',
})

function PhotoTile({ file, lang, onRemove, onRetry }) {
  const url = useThumbUrl(file.thumb)
  const busy = file.status === 'processing' || file.status === 'uploading'
  return (
    <div
      className="photo-slot filled"
      style={{ position: 'relative', opacity: file.status === 'processing' ? 0.55 : 1 }}
      onClick={() => {
        if (file.status === 'failed') onRetry(file.id)
        else if (!busy) onRemove(file.id)
      }}
    >
      {url
        ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{ width: '100%', height: '100%', background: '#EDF0F4' }} />}
      {file.status === 'uploading' && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'rgba(255,255,255,.5)' }}>
          <div style={{ width: `${file.progress}%`, height: '100%', background: ORANGE, transition: 'width .2s' }} />
        </div>
      )}
      <StatusPill file={file} lang={lang} />
    </div>
  )
}

export default function PodFiles({ orderId, leg, lang, maxPhotos = 6, onAddPhoto, onSummary }) {
  const [files, setFiles] = useState([])
  const [online, setOnline] = useState(isOnline())

  useEffect(() => {
    let alive = true
    const load = async () => {
      const list = (await listFiles(orderId, leg)) || []
      if (alive) setFiles(list.sort((a, b) => a.createdAt - b.createdAt))
    }
    load()
    const unsub = subscribe(load)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { alive = false; unsub(); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [orderId, leg])

  const photos = useMemo(() => files.filter((f) => f.kind === 'photo'), [files])
  const documents = useMemo(() => files.filter((f) => f.kind === 'document'), [files])
  const summary = useMemo(() => summarize(files.filter((f) => f.kind !== 'signature')), [files])

  useEffect(() => { if (onSummary) onSummary(summary) }, [summary, onSummary])

  const saved = files.length > 0

  return (
    <>
      <div className="pod-label">{t('photosLabel', lang)} ({photos.length}/{maxPhotos})</div>
      <div className="photo-grid">
        {photos.map((f) => (
          <PhotoTile key={f.id} file={f} lang={lang} onRemove={removeFile} onRetry={retryFile} />
        ))}
        {photos.length < maxPhotos && (
          <div className="photo-slot" onClick={onAddPhoto}>+</div>
        )}
      </div>

      {documents.length > 0 && (
        <div className="doc-chip-list">
          {documents.map((f) => (
            <div
              className="cmr-chip"
              key={f.id}
              onClick={() => (f.status === 'failed' ? retryFile(f.id) : removeFile(f.id))}
            >
              {f.docType === 'cmr' ? t('docTypeCmr', lang)
                : f.docType === 'zustellprotokoll' ? t('docTypeProtocol', lang)
                : t('docTypeOther', lang)}
              {' · '}{f.fileName}
              {' · '}
              {f.status === 'uploading' ? `${f.progress}%`
                : f.status === 'uploaded' || f.status === 'confirmed' ? '✓'
                : f.status === 'failed' ? `⚠ ${t('retryLabel', lang)}`
                : '⏳'}
            </div>
          ))}
        </div>
      )}

      {saved && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.5,
          background: summary.failed > 0 ? '#FCEBE8' : summary.allDone ? '#EAF5EF' : '#FFF6ED',
          border: `1px solid ${summary.failed > 0 ? '#E4A296' : summary.allDone ? '#A8D5BE' : '#FFD2AE'}`,
          color: summary.failed > 0 ? RED : summary.allDone ? GREEN : '#B35A12',
        }}>
          {!online && <div>📴 {t('offlineSyncNote', lang)}</div>}
          {summary.allDone && online && <div>✓ {t('allFilesSynced', lang)}</div>}
          {!summary.allDone && online && summary.failed === 0 && (
            <div>↑ {t('filesPendingSync', lang).replace('{n}', summary.pending + summary.processing)}</div>
          )}
          {summary.failed > 0 && (
            <div>⚠ {t('filesFailedSync', lang).replace('{n}', summary.failed)}</div>
          )}
          <div style={{ marginTop: 4, opacity: .75, color: NAVY }}>
            {t('savedLocallyNote', lang)}
            {files.some((f) => f.bytes) && ` · ${formatBytes(files.reduce((a, f) => a + (f.bytes || 0), 0))}`}
          </div>
        </div>
      )}
    </>
  )
}
