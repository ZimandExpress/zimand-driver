// DocumentCamera.jsx — camera din aplicaţie, cu cadru şi declanşator care se
// aprinde doar când poza IESE bună.
//
// DE CE NU CAMERA TELEFONULUI
//
// Cu `<input capture>` se deschide aplicaţia de cameră a telefonului. Acolo
// nu putem desena nimic şi nu putem opri declanşatorul: şoferul fotografiază
// ce vrea, iar noi aflăm după. „După" înseamnă că omul a plecat de la masă.
//
// Aici vedem fiecare cadru înainte de apăsare, deci putem spune UN lucru de
// făcut („mai aproape", „ţine telefonul drept") şi putem ţine butonul stins
// până se rezolvă. Judecata e în services/documentFrame.js.
//
// Dacă browserul nu dă camera (refuzată, nesuportată), nu blocăm nimic:
// chemăm `onSystemCamera` şi se fotografiază cu camera telefonului, ca înainte.

import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { analizeazaCadru } from '../services/documentFrame'

// Cadrul de analiză: redus la 480 px pe latura mare. Mai mult nu ajută la
// nimic şi ar încălzi telefonul degeaba — măsurăm formă şi lumină, nu citim
// textul.
const LATURA_ANALIZA = 480
const INTERVAL_MS = 220
// Două cadre bune la rând, nu unul. Un singur cadru bun apare şi din
// întâmplare, când mâna trece prin poziţia corectă.
const CADRE_BUNE = 2

// Dreptunghiul ghid, în pixeli ai imaginii date. A4 vertical.
export function chenarGhid(w, h) {
  let W = w * 0.84
  let H = W * 1.414
  if (H > h * 0.88) { H = h * 0.88; W = H / 1.414 }
  return { x: (w - W) / 2, y: (h - H) / 2, w: W, h: H }
}

export default function DocumentCamera({ lang, titlu, onCapture, onCancel, onSystemCamera }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const bunePeRand = useRef(0)
  const [verdict, setVerdict] = useState(null)
  const [gata, setGata] = useState(false)
  const [eroare, setEroare] = useState(null)
  const [lanterna, setLanterna] = useState(false)
  const [areLanterna, setAreLanterna] = useState(false)
  const [lucreaza, setLucreaza] = useState(false)
  // Dimensiunea imaginii de la cameră. Chenarul desenat pe ecran trebuie să
  // fie ACELAŞI cu cel măsurat — altfel şoferul potriveşte documentul într-un
  // dreptunghi, iar verdictul vine din altul. De aceea nu scriem procente
  // fixe: le calculăm din imagine, cu aceeaşi funcţie.
  const [dim, setDim] = useState(null)

  // --- camera -------------------------------------------------------------
  useEffect(() => {
    let viu = true
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setEroare('unsupported'); return }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1440 },
            height: { ideal: 1920 },
            aspectRatio: { ideal: 0.75 },
          },
          audio: false,
        })
        if (!viu) { stream.getTracks().forEach((t2) => t2.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            const v = videoRef.current
            if (v?.videoWidth) setDim({ w: v.videoWidth, h: v.videoHeight })
          }
          await videoRef.current.play().catch(() => {})
        }
        const track = stream.getVideoTracks()[0]
        const cap = track?.getCapabilities?.() || {}
        setAreLanterna(!!cap.torch)
      } catch (e) {
        setEroare(e?.name === 'NotAllowedError' ? 'denied' : 'unavailable')
      }
    })()
    return () => {
      viu = false
      if (streamRef.current) streamRef.current.getTracks().forEach((t2) => t2.stop())
      streamRef.current = null
    }
  }, [])

  // Lanterna: nu toate telefoanele o dau prin browser, de aceea butonul
  // apare numai când există.
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks?.()[0]
    if (!track || !areLanterna) return
    track.applyConstraints({ advanced: [{ torch: lanterna }] }).catch(() => {})
  }, [lanterna, areLanterna])

  // --- judecata, cadru cu cadru ------------------------------------------
  useEffect(() => {
    if (eroare) return
    let opresteT = null
    let activ = true

    const pas = () => {
      if (!activ) return
      const v = videoRef.current
      if (v && v.videoWidth && v.videoHeight) {
        const scara = LATURA_ANALIZA / Math.max(v.videoWidth, v.videoHeight)
        const w = Math.round(v.videoWidth * scara)
        const h = Math.round(v.videoHeight * scara)
        let c = canvasRef.current
        if (!c) { c = document.createElement('canvas'); canvasRef.current = c }
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
        const g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(v, 0, 0, w, h)
        const ch = chenarGhid(w, h)
        const { data } = g.getImageData(0, 0, w, h)
        const r = analizeazaCadru(data, w, h, ch)
        setVerdict(r)
        if (!dim || dim.w !== v.videoWidth) setDim({ w: v.videoWidth, h: v.videoHeight })
        bunePeRand.current = r.ok ? bunePeRand.current + 1 : 0
        setGata(bunePeRand.current >= CADRE_BUNE)
      }
      opresteT = setTimeout(pas, INTERVAL_MS)
    }
    opresteT = setTimeout(pas, 300)
    return () => { activ = false; if (opresteT) clearTimeout(opresteT) }
  }, [eroare, dim])

  // --- poza ---------------------------------------------------------------
  async function fotografiaza() {
    const v = videoRef.current
    if (!v || !v.videoWidth || lucreaza) return
    setLucreaza(true)
    try {
      // Decupăm exact chenarul, cu o margine de 3% în jur: pe hârtie,
      // marginea albă face parte din document şi ajută la citit.
      const ch = chenarGhid(v.videoWidth, v.videoHeight)
      const m = Math.round(Math.min(ch.w, ch.h) * 0.03)
      const sx = Math.max(0, Math.round(ch.x - m))
      const sy = Math.max(0, Math.round(ch.y - m))
      const sw = Math.min(v.videoWidth - sx, Math.round(ch.w + 2 * m))
      const sh = Math.min(v.videoHeight - sy, Math.round(ch.h + 2 * m))
      const out = document.createElement('canvas')
      out.width = sw
      out.height = sh
      out.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh)
      const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.92))
      if (!blob) { setLucreaza(false); return }
      const file = new File([blob], `dokument-${Date.now()}.jpg`, { type: 'image/jpeg' })
      onCapture(file)
    } catch {
      setLucreaza(false)
    }
  }

  // --- camera refuzată: ieşirea pe camera telefonului --------------------
  if (eroare) {
    return (
      <div className="sig-fullscreen" style={{ background: '#fff', flexDirection: 'column', justifyContent: 'center', padding: 22 }}>
        <div style={{ maxWidth: 420, width: '100%' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📷</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#0F2240', marginBottom: 8, lineHeight: 1.3 }}>
            {t('frameCamBlockedTitle', lang)}
          </div>
          <div style={{ fontSize: 13.5, color: '#6B7A90', lineHeight: 1.55, marginBottom: 18 }}>
            {t(eroare === 'denied' ? 'frameCamBlocked' : 'frameCamUnavailable', lang)}
          </div>
          <button className="btn" style={{ width: '100%' }} onClick={onSystemCamera}>
            {t('frameUseSystem', lang)}
          </button>
          <button type="button" className="link-btn" style={{ marginTop: 12 }} onClick={onCancel}>
            {t('cancel', lang)}
          </button>
        </div>
      </div>
    )
  }

  const culoare = gata ? '#2FBF71' : (verdict && verdict.sfat) ? '#E9A23B' : '#FF7A29'
  const gh = dim ? chenarGhid(dim.w, dim.h) : null
  const ch = gh && dim
    ? { x: (gh.x / dim.w) * 100, y: (gh.y / dim.h) * 100, w: (gh.w / dim.w) * 100, h: (gh.h / dim.h) * 100 }
    : { x: 8, y: 6, w: 84, h: 88 }
  const indiciu = gata ? t('frameReady', lang)
    : verdict?.hint ? t(verdict.hint, lang)
    : t('frameHold', lang)

  return (
    <div className="sig-fullscreen" style={{ background: '#0B1420', flexDirection: 'column', justifyContent: 'space-between', padding: 0 }}>
      {/* Titlul: ce document se fotografiază. Şoferul deschide ecranul
          acesta de patru ori la o ridicare de documente. */}
      <div style={{
        padding: 'calc(14px + env(safe-area-inset-top, 0px)) 16px 10px',
        color: '#fff', fontSize: 14.5, fontWeight: 700, textAlign: 'center',
      }}>
        {titlu}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {/* Cutia are raportul imaginii, deci procentele chenarului cad exact
            peste pixelii măsuraţi. Cu `object-fit: contain` pe un element de
            alt raport, dreptunghiul desenat ar fi alunecat lângă cel real. */}
        <div style={{
          position: 'relative',
          aspectRatio: dim ? `${dim.w} / ${dim.h}` : '3 / 4',
          width: '100%', maxWidth: '100%', maxHeight: '100%',
          margin: '0 auto',
        }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
        />
        {/* Cadrul, desenat peste imagine. Colţuri, nu un dreptunghi plin:
            un contur continuu ascunde exact muchia pe care şoferul o
            potriveşte. */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute',
            left: `${ch.x}%`, top: `${ch.y}%`, width: `${ch.w}%`, height: `${ch.h}%`,
            boxShadow: '0 0 0 9999px rgba(11,20,32,.55)',
            border: `2px solid ${culoare}`,
            borderRadius: 6,
            transition: 'border-color .18s',
          }}>
            {[['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']].map(([a, b]) => (
              <span
                key={a + b}
                style={{
                  position: 'absolute', [a]: -3, [b]: -3, width: 26, height: 26,
                  [`border${a[0].toUpperCase()}${a.slice(1)}`]: `5px solid ${culoare}`,
                  [`border${b[0].toUpperCase()}${b.slice(1)}`]: `5px solid ${culoare}`,
                  borderRadius: 3,
                }}
              />
            ))}
          </div>
        </div>
        </div>
      </div>

      {/* O singură îndrumare, cea mai gravă. O listă de patru nu se citeşte
          cu telefonul într-o mână şi documentul în cealaltă. */}
      <div style={{ padding: '12px 16px 0', textAlign: 'center' }}>
        <div style={{
          display: 'inline-block', background: gata ? 'rgba(47,191,113,.16)' : 'rgba(255,255,255,.1)',
          border: `1px solid ${culoare}`, color: gata ? '#8FE8B5' : '#fff',
          borderRadius: 10, padding: '9px 13px', fontSize: 13.5, fontWeight: 600, lineHeight: 1.45,
          maxWidth: 420,
        }}>
          {gata ? '✓ ' : ''}{indiciu}
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px calc(16px + env(safe-area-inset-bottom, 0px))',
      }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,.35)',
            color: '#fff', borderRadius: 10, padding: '11px 14px', fontSize: 13.5,
            fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {t('cancel', lang)}
        </button>

        {/* Declanşatorul: stins până la două cadre bune la rând. Atins
            devreme, spune de ce — nu rămâne mut. */}
        <button
          type="button"
          onClick={fotografiaza}
          disabled={!gata || lucreaza}
          style={{
            flex: 1, borderRadius: 12, border: 'none', padding: '14px 16px',
            background: gata ? '#2FBF71' : 'rgba(255,255,255,.18)',
            color: gata ? '#06220F' : 'rgba(255,255,255,.55)',
            fontSize: 15.5, fontWeight: 800,
            cursor: gata ? 'pointer' : 'not-allowed',
            transition: 'background .18s',
          }}
        >
          {lucreaza ? '…' : t('frameShoot', lang)}
        </button>

        {areLanterna && (
          <button
            type="button"
            onClick={() => setLanterna((v) => !v)}
            aria-label={t('frameTorch', lang)}
            style={{
              background: lanterna ? '#FFD98A' : 'transparent',
              border: '1px solid rgba(255,255,255,.35)',
              color: lanterna ? '#5A4412' : '#fff',
              borderRadius: 10, padding: '11px 13px', fontSize: 16, cursor: 'pointer',
            }}
          >
            🔆
          </button>
        )}
      </div>
    </div>
  )
}
