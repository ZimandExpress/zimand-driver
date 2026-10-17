// DocumentCrop.jsx — decupajul unui document fotografiat cu camera telefonului.
//
// Camera din aplicaţie (DocumentCamera) lua poza dintr-un cadru video, iar
// scrisul ieşea neclar. Camera obişnuită a telefonului face cele mai clare
// poze (focalizare, rezoluţie întreagă), dar nu putem desena chenarul în ea.
// De aceea decupajul se face DUPĂ: pe poză apar patru colţuri, puse automat
// pe foaie când o găsim, pe care şoferul le poate trage cu degetul. La
// „weiter" foaia e îndreptată şi decupată exact după cele patru colţuri.
// Ales de Andrei pe 17.10.2026.

import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { incarcaOpenCv } from './DocumentCamera'

const LATURA_MAX = 3000 // ~250 dpi pe A4

async function decodeaza(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* mai jos */ }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
    img.src = url
  })
}

function laCanvas(sursa, scara) {
  const w = sursa.width || sursa.naturalWidth
  const h = sursa.height || sursa.naturalHeight
  const c = document.createElement('canvas')
  c.width = Math.round(w * scara)
  c.height = Math.round(h * scara)
  const g = c.getContext('2d', { willReadFrequently: true })
  g.imageSmoothingQuality = 'high'
  g.drawImage(sursa, 0, 0, c.width, c.height)
  return c
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// Ordinea: stânga-sus, dreapta-sus, dreapta-jos, stânga-jos.
function ordoneaza(p) {
  const s = p.map((q) => q.x + q.y)
  const d = p.map((q) => q.y - q.x)
  const tl = p[s.indexOf(Math.min(...s))]
  const br = p[s.indexOf(Math.max(...s))]
  const tr = p[d.indexOf(Math.min(...d))]
  const bl = p[d.indexOf(Math.max(...d))]
  return new Set([tl, tr, br, bl]).size === 4 ? [tl, tr, br, bl] : null
}

// Încearcă să găsească foaia. Colţurile, în coordonate 0..1, sau null.
async function gasesteFoaia(canvasMic) {
  try { await incarcaOpenCv() } catch { return null }
  const cv = window.cv
  const W = canvasMic.width, H = canvasMic.height, A = W * H
  let best = null
  const variante = [
    (g, b) => { cv.Canny(g, b, 40, 120); const k = cv.Mat.ones(5, 5, cv.CV_8U); cv.dilate(b, b, k); k.delete() },
    (g, b) => { cv.Canny(g, b, 15, 50); const k = cv.Mat.ones(5, 5, cv.CV_8U); cv.dilate(b, b, k); k.delete() },
    (g, b) => { cv.threshold(g, b, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU) },
  ]
  for (const prep of variante) {
    const de = []
    try {
      const src = cv.imread(canvasMic); de.push(src)
      const g = new cv.Mat(); de.push(g)
      cv.cvtColor(src, g, cv.COLOR_RGBA2GRAY)
      cv.GaussianBlur(g, g, new cv.Size(5, 5), 0)
      const b = new cv.Mat(); de.push(b)
      prep(g, b)
      const cs = new cv.MatVector(); de.push(cs)
      const h = new cv.Mat(); de.push(h)
      cv.findContours(b, cs, h, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
      for (let i = 0; i < cs.size(); i++) {
        const c = cs.get(i)
        const aria = cv.contourArea(c)
        if (aria > A * 0.15 && aria < A * 0.95) {
          const hull = new cv.Mat()
          cv.convexHull(c, hull)
          const ap = new cv.Mat()
          cv.approxPolyDP(hull, ap, 0.03 * cv.arcLength(hull, true), true)
          if (ap.rows === 4 && (!best || aria > best.aria)) {
            const pts = []
            for (let j = 0; j < 4; j++) pts.push({ x: ap.data32S[j * 2] / W, y: ap.data32S[j * 2 + 1] / H })
            const o = ordoneaza(pts)
            if (o) {
              const lat = Math.max(dist(o[0], o[1]) * W, dist(o[3], o[2]) * W)
              const ina = Math.max(dist(o[0], o[3]) * H, dist(o[1], o[2]) * H)
              const r = Math.min(lat, ina) / Math.max(lat, ina)
              if (r > 0.5 && r < 0.9) best = { aria, p: o }
            }
          }
          ap.delete(); hull.delete()
        }
        c.delete()
      }
    } catch { /* varianta următoare */ } finally {
      de.forEach((m) => { try { m.delete() } catch { /* nimic */ } })
    }
  }
  return best ? best.p : null
}

// Îndreaptă foaia după cele patru colţuri (0..1). OpenCV dacă e încărcat,
// altfel un decupaj drept, după dreptunghiul care le cuprinde.
async function decupeaza(canvasMare, colturi) {
  const W = canvasMare.width, H = canvasMare.height
  const p = colturi.map((q) => ({ x: q.x * W, y: q.y * H }))
  const outW = Math.round(Math.max(dist(p[0], p[1]), dist(p[3], p[2])))
  const outH = Math.round(Math.max(dist(p[0], p[3]), dist(p[1], p[2])))
  try {
    await incarcaOpenCv()
    const cv = window.cv
    const de = []
    try {
      const src = cv.imread(canvasMare); de.push(src)
      const a = cv.matFromArray(4, 1, cv.CV_32FC2, p.flatMap((q) => [q.x, q.y])); de.push(a)
      const b = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]); de.push(b)
      const M = cv.getPerspectiveTransform(a, b); de.push(M)
      const dst = new cv.Mat(); de.push(dst)
      cv.warpPerspective(src, dst, M, new cv.Size(outW, outH), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar())
      const out = document.createElement('canvas')
      cv.imshow(out, dst)
      return out
    } finally {
      de.forEach((m) => { try { m.delete() } catch { /* nimic */ } })
    }
  } catch {
    const xs = p.map((q) => q.x), ys = p.map((q) => q.y)
    const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys))
    const x1 = Math.min(W, Math.max(...xs)), y1 = Math.min(H, Math.max(...ys))
    const out = document.createElement('canvas')
    out.width = Math.round(x1 - x0)
    out.height = Math.round(y1 - y0)
    out.getContext('2d').drawImage(canvasMare, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
    return out
  }
}

const INITIAL = [{ x: 0.06, y: 0.06 }, { x: 0.94, y: 0.06 }, { x: 0.94, y: 0.94 }, { x: 0.06, y: 0.94 }]

export default function DocumentCrop({ file, lang, titlu, onDone, onRetake }) {
  const [url, setUrl] = useState(null)
  const [colturi, setColturi] = useState(INITIAL)
  const [cauta, setCauta] = useState(true)
  const [lucreaza, setLucreaza] = useState(false)
  const mareRef = useRef(null)
  const zonaRef = useRef(null)
  const tras = useRef(null)

  useEffect(() => {
    let viu = true
    const u = URL.createObjectURL(file)
    setUrl(u)
    ;(async () => {
      try {
        const bmp = await decodeaza(file)
        const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight
        mareRef.current = laCanvas(bmp, Math.min(1, LATURA_MAX / Math.max(w, h)))
        if (bmp.close) bmp.close()
        const mic = laCanvas(mareRef.current, 900 / Math.max(mareRef.current.width, mareRef.current.height))
        const g = await gasesteFoaia(mic)
        if (viu && g) setColturi(g)
      } catch { /* rămân colţurile implicite */ }
      if (viu) setCauta(false)
    })()
    return () => { viu = false; URL.revokeObjectURL(u) }
  }, [file])

  const pozitie = (e) => {
    const r = zonaRef.current.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const apasa = (i) => (e) => { e.preventDefault(); tras.current = i; e.currentTarget.setPointerCapture?.(e.pointerId) }
  const misca = (e) => {
    if (tras.current == null) return
    const q = pozitie(e)
    setColturi((c) => c.map((p, j) => (j === tras.current ? q : p)))
  }
  const ridica = () => { tras.current = null }

  async function gata(intreg) {
    if (!mareRef.current || lucreaza) return
    setLucreaza(true)
    try {
      const out = intreg ? mareRef.current : await decupeaza(mareRef.current, colturi)
      const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.92))
      if (!blob) { setLucreaza(false); return }
      onDone(new File([blob], `dokument-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    } catch {
      setLucreaza(false)
    }
  }

  const poli = colturi.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')
  return (
    <div className="sig-fullscreen" style={{ background: '#0B1420', flexDirection: 'column', justifyContent: 'space-between', padding: 0, zIndex: 10000 }}>
      <div style={{ padding: 'calc(14px + env(safe-area-inset-top, 0px)) 16px 6px', color: '#fff', textAlign: 'center' }}>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{titlu}</div>
        <div style={{ fontSize: 13, color: '#C9D5E8', marginTop: 4, lineHeight: 1.4 }}>
          {cauta ? t('cropSearching', lang) : t('cropHint', lang)}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 14px', minHeight: 0 }}>
        {url && (
          <div ref={zonaRef} style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', touchAction: 'none' }}
               onPointerMove={misca} onPointerUp={ridica} onPointerCancel={ridica}>
            <img src={url} alt="" draggable={false}
                 style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 230px)', userSelect: 'none' }} />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none"
                 style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              <polygon points={poli} fill="rgba(47,191,113,.18)" stroke="#2FBF71" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
            </svg>
            {colturi.map((p, i) => (
              <span key={i} onPointerDown={apasa(i)}
                    style={{
                      position: 'absolute', left: `${p.x * 100}%`, top: `${p.y * 100}%`,
                      width: 34, height: 34, marginLeft: -17, marginTop: -17, borderRadius: '50%',
                      background: 'rgba(255,255,255,.9)', border: '3px solid #2FBF71',
                      boxShadow: '0 2px 8px rgba(0,0,0,.4)', touchAction: 'none', cursor: 'grab',
                    }} />
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '10px 16px calc(14px + env(safe-area-inset-bottom, 0px))' }}>
        <button type="button" className="btn" style={{ width: '100%', margin: 0 }} disabled={lucreaza || cauta} onClick={() => gata(false)}>
          {lucreaza ? '…' : t('cropUse', lang)}
        </button>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button type="button" className="btn secondary" style={{ flex: 1, margin: 0 }} disabled={lucreaza} onClick={onRetake}>
            {t('qRetake', lang)}
          </button>
          <button type="button" className="btn secondary" style={{ flex: 1, margin: 0 }} disabled={lucreaza || cauta} onClick={() => gata(true)}>
            {t('cropWhole', lang)}
          </button>
        </div>
      </div>
    </div>
  )
}
