// PodFiles.jsx — grila de poze + lista de documente, alimentate din coada
// persistentă. Fiecare fișier are propriul status și propriul procent (§17).
//
// Componenta nu ține fișiere în state-ul React: citește din IndexedDB la
// fiecare schimbare anunțată de coadă. Închiderea aplicației nu pierde nimic.

import { useEffect, useState, useMemo } from 'react'
import { t } from '../i18n'
import {
  subscribe, listFiles, removeFile, retryFile, retryAllFailed, summarize, isOnline,
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

function PhotoTile({ file, lang, onRemove, onRetry, onOpen }) {
  const url = useThumbUrl(file.thumb)
  const busy = file.status === 'processing' || file.status === 'uploading'
  return (
    <div
      className="photo-slot filled"
      style={{ position: 'relative', opacity: file.status === 'processing' ? 0.55 : 1 }}
      onClick={() => {
        // Atins pe poză ȘTERGEA, pe loc și fără întrebare. Șoferul care
        // voia doar să vadă ce-a ieșit rămânea fără poză și fără marfa în
        // faţă. Acum se deschide mare, iar ștersul e un buton acolo.
        if (file.status === 'failed') onRetry(file.id)
        else if (!busy) onOpen(file)
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

// Poza, pe tot ecranul. De aici se șterge — nu dintr-o atingere greșită
// pe grila de miniaturi.
function PhotoPreview({ file, lang, onClose, onDelete }) {
  const url = useThumbUrl(file.thumb)
  return (
    <div
      className="sig-fullscreen"
      style={{ background: 'rgba(15,34,64,.92)', flexDirection: 'column', justifyContent: 'center', padding: 16 }}
    >
      {url
        ? <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 10 }} />
        : <div style={{ color: '#fff', fontSize: 14 }}>{t('photoOpenLabel', lang)}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 18, width: '100%', maxWidth: 420 }}>
        <button
          type="button"
          onClick={onDelete}
          style={{
            flex: 1, padding: '12px 14px', borderRadius: 10, border: 'none',
            background: RED, color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {t('photoDeleteLabel', lang)}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            flex: 1, padding: '12px 14px', borderRadius: 10,
            border: '1px solid rgba(255,255,255,.35)', background: 'transparent',
            color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {t('back', lang)}
        </button>
      </div>
    </div>
  )
}

export default function PodFiles({ orderId, leg, lang, maxPhotos = 6, minPhotos = 0, onAddPhoto, onSummary, photoHints = [] }) {
  const [files, setFiles] = useState([])
  const [online, setOnline] = useState(isOnline())
  const [privita, setPrivita] = useState(null)

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

  const photos = useMemo(() => files.filter((f) => f.kind === 'photo' && f.status !== 'lost'), [files])
  const documents = useMemo(() => files.filter((f) => f.kind === 'document'), [files])
  // Pe lângă starea încărcării, ecranul de confirmare are nevoie să ştie
  // CE s-a încărcat: la livrările de documente, Zustellprotokoll-ul e
  // obligatoriu, iar o poză nu ţine locul lui.
  const summary = useMemo(() => {
    const relevante = files.filter((f) => f.kind !== 'signature')
    return {
      ...summarize(relevante),
      // Fişierele pierdute la captură NU se numără.
      //
      // `summarize` le scoate deja din total, dar numărătoarea de poze le
      // lăsa înăuntru: după două poze pierdute şi una refăcută, regula „cel
      // puţin două poze" se considera îndeplinită cu o singură poză reală.
      photoCount: relevante.filter((f) => f.kind === 'photo' && f.status !== 'lost').length,
      documentCount: relevante.filter((f) => f.kind === 'document' && f.status !== 'lost').length,
      // CARE documente, nu doar câte. La o ridicare de documente se cer
      // două formulare anume; numărate, două poze oarecare treceau drept
      // protocol și declaraţie de predare.
      documentTypes: relevante
        .filter((f) => f.kind === 'document' && f.status !== 'lost')
        .map((f) => f.docType || 'other'),
    }
  }, [files])

  useEffect(() => { if (onSummary) onSummary(summary) }, [summary, onSummary])

  const saved = files.length > 0

  return (
    <>
      {/* Numărul cerut stă pe aceeași linie: „Fotos (1/6) · min. 2“.
          Altfel șoferul afla câte trebuie abia de la butonul stins. */}
      <div className="pod-label" style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span>{t('photosLabel', lang)} ({photos.length}/{maxPhotos})</span>
        {minPhotos > 0 && photos.length < minPhotos && (
          <span style={{ fontSize: 11, fontWeight: 700, color: ORANGE, letterSpacing: 0 }}>
            {t('minPhotosInline', lang).replace('{n}', minPhotos)}
          </span>
        )}
      </div>
      {/* Mai strâns: patru pe rând în loc de trei. Șase locuri intrau pe două
          rânduri înalte care împingeau restul formularului sub marginea
          ecranului, iar șoferul derula ca să ajungă la nume și semnătură. */}
      <div className="photo-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {photos.map((f) => (
          <PhotoTile key={f.id} file={f} lang={lang} onRemove={removeFile} onRetry={retryFile} onOpen={setPrivita} />
        ))}
        {/* Locurile goale spun CE se aşteaptă în fiecare.
            O instrucţiune ascunsă după un buton o citeşte cine era oricum
            atent; scrisă în pătratul gol, o vede şi cel grăbit — devine o
            listă de cumpărături, nu o lecţie. */}
        {photos.length < maxPhotos && (() => {
          const ramase = Math.max(0, maxPhotos - photos.length)
          const indicatii = photoHints.slice(photos.length)
          const locuri = []
          for (let i = 0; i < ramase; i++) {
            const hint = indicatii[i]
            const primul = i === 0
            locuri.push(
              <div
                key={'slot' + i}
                className="photo-slot"
                onClick={primul ? onAddPhoto : undefined}
                style={{
                  opacity: primul ? 1 : 0.55,
                  cursor: primul ? 'pointer' : 'default',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 3, textAlign: 'center', padding: 6,
                }}
              >
                {hint ? (
                  <>
                    <span style={{ fontSize: 17, lineHeight: 1 }}>{primul ? '📷' : '○'}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.25 }}>{hint}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 20, lineHeight: 1 }}>+</span>
                )}
              </div>
            )
          }
          return locuri
        })()}
      </div>

      {privita && (
        <PhotoPreview
          file={privita}
          lang={lang}
          onClose={() => setPrivita(null)}
          onDelete={() => { removeFile(privita.id); setPrivita(null) }}
        />
      )}

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
                : f.docType === 'botenbestaetigung' ? t('docTypeBote', lang)
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
          {summary.lost > 0 && (
            <div style={{ marginBottom: 7 }}>
              ⚠ {t('photosLost', lang).replace('{n}', summary.lost)}
            </div>
          )}
          {summary.failed > 0 && (
            <>
              <div>⚠ {t('filesFailedSync', lang).replace('{n}', summary.failed)}</div>
              {/* Un singur buton pentru toate fişierele căzute. Atinsul poză
                  cu poză era de nefăcut cu mâinile pline, în stradă. */}
              <button
                onClick={() => { void retryAllFailed() }}
                disabled={!online}
                style={{
                  marginTop: 7, width: '100%', padding: '9px 12px', borderRadius: 8,
                  border: 'none', background: online ? RED : '#C9B3AE', color: '#fff',
                  fontSize: 13.5, fontWeight: 700, cursor: online ? 'pointer' : 'default',
                }}
              >
                ↻ {t('retryAllLabel', lang)}
              </button>
            </>
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
