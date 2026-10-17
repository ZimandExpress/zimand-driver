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
//
// Mai multe încercări, fiecare dă candidaţi (patrulatere); câştigă cel care
// seamănă cel mai mult cu o foaie: mare, cu proporţii de pagină, iar
// înăuntru mai luminos şi mai puţin colorat decât în jur (hârtia e albă,
// masa sau podeaua nu). Aşa merge şi pe lemn deschis, unde muchiile singure
// nu ajung.
async function gasesteFoaia(canvasMic) {
  try { await incarcaOpenCv() } catch { return null }
  const cv = window.cv
  const W = canvasMic.width, H = canvasMic.height, A = W * H
  const de = []
  const nou = (m) => { de.push(m); return m }
  try {
    const src = nou(cv.imread(canvasMic))
    const rgb = nou(new cv.Mat())
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
    const gri = nou(new cv.Mat())
    cv.cvtColor(rgb, gri, cv.COLOR_RGB2GRAY)
    const hsv = nou(new cv.Mat())
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    const can = nou(new cv.MatVector())
    cv.split(hsv, can)
    const sat = can.get(1); de.push(sat)
    const val = can.get(2); de.push(val)
    const blur = nou(new cv.Mat())
    cv.GaussianBlur(gri, blur, new cv.Size(5, 5), 0)

    // „Albul hârtiei": luminos şi puţin colorat. Scor per pixel = V − S.
    const alb = nou(new cv.Mat())
    cv.subtract(val, sat, alb)
    cv.GaussianBlur(alb, alb, new cv.Size(7, 7), 0)

    const masti = []
    const k5 = nou(cv.Mat.ones(5, 5, cv.CV_8U))
    const k15 = nou(cv.Mat.ones(15, 15, cv.CV_8U))
    for (const [lo, hi] of [[40, 120], [15, 50]]) {
      const m = nou(new cv.Mat()); cv.Canny(blur, m, lo, hi); cv.dilate(m, m, k5); masti.push(m)
    }
    { const m = nou(new cv.Mat()); cv.threshold(blur, m, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); cv.morphologyEx(m, m, cv.MORPH_OPEN, k15); masti.push(m) }
    { const m = nou(new cv.Mat()); cv.threshold(alb, m, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); cv.morphologyEx(m, m, cv.MORPH_OPEN, k15); cv.morphologyEx(m, m, cv.MORPH_CLOSE, k15); masti.push(m) }
    // Praguri după cele mai albe părţi ale pozei (80 % şi 88 %): pe o podea
    // sau masă deschisă la culoare, foaia e totuşi partea cea mai albă.
    {
      const date = alb.data
      const hist = new Array(256).fill(0)
      for (let i = 0; i < date.length; i++) hist[date[i]]++
      const prag = (pct) => { let acc = 0; const tinta = date.length * pct; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= tinta) return v } return 255 }
      const k9 = nou(cv.Mat.ones(9, 9, cv.CV_8U))
      for (const pct of [0.8, 0.88]) {
        const m = nou(new cv.Mat())
        cv.threshold(alb, m, prag(pct), 255, cv.THRESH_BINARY)
        cv.morphologyEx(m, m, cv.MORPH_OPEN, k9)
        cv.morphologyEx(m, m, cv.MORPH_CLOSE, k15)
        masti.push(m)
      }
    }

    const medieIn = (pts) => {
      // Luminozitatea „albului" înăuntru faţă de o bandă din afară.
      const mask = nou(cv.Mat.zeros(H, W, cv.CV_8U))
      const poly = nou(cv.matFromArray(4, 1, cv.CV_32SC2, pts.flatMap((q) => [Math.round(q.x * W), Math.round(q.y * H)])))
      const v = nou(new cv.MatVector()); v.push_back(poly)
      cv.fillPoly(mask, v, new cv.Scalar(255))
      const inauntru = cv.mean(alb, mask)[0]
      const mare = nou(new cv.Mat()); cv.dilate(mask, mare, nou(cv.Mat.ones(31, 31, cv.CV_8U)))
      const banda = nou(new cv.Mat()); cv.subtract(mare, mask, banda)
      const afara = cv.mean(alb, banda)[0]
      return inauntru - afara
    }

    // Muchiile foii trebuie să se vadă pe TOATE cele patru laturi. Un
    // patrulater „găsit" în fundal taie prin podea, iar laturile lui nu
    // stau pe nicio muchie. Măsurăm, pe fiecare latură, cât din ea cade pe
    // o muchie (harta Canny lărgită).
    const muchii = masti[1]
    const laturaPeMuchie = (a, b) => {
      let pe = 0
      const n = 40
      for (let i = 1; i < n; i++) {
        const x = Math.round((a.x + (b.x - a.x) * i / n) * (W - 1))
        const y = Math.round((a.y + (b.y - a.y) * i / n) * (H - 1))
        if (muchii.ucharPtr(y, x)[0] > 0) pe++
      }
      return pe / (n - 1)
    }

    let best = null
    for (const m of masti) {
      const cs = nou(new cv.MatVector())
      const h = nou(new cv.Mat())
      cv.findContours(m, cs, h, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
      for (let i = 0; i < cs.size(); i++) {
        const c = cs.get(i)
        const aria = cv.contourArea(c)
        if (aria < A * 0.08 || aria > A * 0.96) { c.delete(); continue }
        const hull = new cv.Mat()
        cv.convexHull(c, hull)
        let pts = null
        for (const eps of [0.02, 0.03, 0.05]) {
          const ap = new cv.Mat()
          cv.approxPolyDP(hull, ap, eps * cv.arcLength(hull, true), true)
          if (ap.rows === 4) {
            pts = []
            for (let j = 0; j < 4; j++) pts.push({ x: ap.data32S[j * 2] / W, y: ap.data32S[j * 2 + 1] / H })
          }
          ap.delete()
          if (pts) break
        }
        if (!pts) {
          // Nu iese un patrulater curat: dreptunghiul minim care cuprinde forma.
          const r = cv.minAreaRect(hull)
          const v = cv.RotatedRect.points(r)
          pts = v.map((q) => ({ x: q.x / W, y: q.y / H }))
        }
        hull.delete(); c.delete()
        const o = ordoneaza(pts)
        if (!o) continue
        const lat = Math.max(dist(o[0], o[1]) * W, dist(o[3], o[2]) * W)
        const ina = Math.max(dist(o[0], o[3]) * H, dist(o[1], o[2]) * H)
        const raport = Math.min(lat, ina) / Math.max(lat, ina)
        if (raport < 0.45 || raport > 0.92) continue
        const contrast = medieIn(o)
        if (contrast < 8) continue
        const peMuchii = Math.min(laturaPeMuchie(o[0], o[1]), laturaPeMuchie(o[1], o[2]), laturaPeMuchie(o[2], o[3]), laturaPeMuchie(o[3], o[0]))
        if (peMuchii < 0.55) continue
        // Scorul: suprafaţa, contrastul hârtie/fundal şi apropierea de A4.
        // Un patrulater lipit de marginea pozei e de obicei fundalul (podea,
        // masă), nu foaia: foaia fotografiată are aproape mereu fundal în jur.
        const peMargine = o.filter((q) => q.x < 0.02 || q.x > 0.98 || q.y < 0.02 || q.y > 0.98).length
        // Două colţuri sau mai multe pe marginea pozei: aproape sigur fundalul.
        // Mai bine colţurile implicite (le trage şoferul) decât unele greşite.
        if (peMargine >= 2) continue
        const scor = (aria / A) * Math.min(contrast, 80) * (1 - Math.min(1, Math.abs(raport - 0.707) * 2))
          * (peMargine === 0 ? 1 : peMargine === 1 ? 0.5 : 0.1) * peMuchii
        if (!best || scor > best.scor) best = { scor, p: o.map((q) => ({ x: Math.min(1, Math.max(0, q.x)), y: Math.min(1, Math.max(0, q.y)) })) }
      }
    }
    return best ? best.p : null
  } catch {
    return null
  } finally {
    de.forEach((m) => { try { m.delete() } catch { /* nimic */ } })
  }
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

// Luminozitate şi contrast, aplicate la fel ca filtrul CSS din previzualizare
// (brightness, apoi contrast), ca fişierul să arate exact ca pe ecran.
function aplicaLumina(canvas, lum, con) {
  if (!lum && !con) return canvas
  const bf = 1 + lum / 100
  const cf = 1 + con / 100
  const g = canvas.getContext('2d', { willReadFrequently: true })
  const img = g.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = Math.round((v * bf - 128) * cf + 128)
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]] }
  g.putImageData(img, 0, 0)
  return canvas
}

const INITIAL = [{ x: 0.06, y: 0.06 }, { x: 0.94, y: 0.06 }, { x: 0.94, y: 0.94 }, { x: 0.06, y: 0.94 }]

export default function DocumentCrop({ file, lang, titlu, onDone, onRetake }) {
  const [url, setUrl] = useState(null)
  const [colturi, setColturi] = useState(INITIAL)
  const [cauta, setCauta] = useState(true)
  const [lucreaza, setLucreaza] = useState(false)
  // Bara de luminozitate şi cea de contrast (cerute de Andrei pe 17.10.2026),
  // pentru foi fotografiate în umbră sau scris palid.
  const [lum, setLum] = useState(0)
  const [con, setCon] = useState(0)
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
      let out = intreg ? mareRef.current : await decupeaza(mareRef.current, colturi)
      if (lum || con) {
        if (out === mareRef.current) {
          const copie = document.createElement('canvas')
          copie.width = out.width; copie.height = out.height
          copie.getContext('2d').drawImage(out, 0, 0)
          out = copie
        }
        aplicaLumina(out, lum, con)
      }
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
                 style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 320px)', userSelect: 'none',
                          filter: `brightness(${1 + lum / 100}) contrast(${1 + con / 100})` }} />
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
        {[[t('cropBrightness', lang), '', lum, setLum, -60, 60], [t('cropContrast', lang), '', con, setCon, -40, 80]].map(([eticheta, semn, val, setVal, min, max]) => (
          <label key={eticheta} style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', fontSize: 13, marginBottom: 8 }}>
            <span style={{ width: 82, flex: '0 0 auto' }}>{eticheta}</span>
            <input type="range" min={min} max={max} step={1} value={val} onChange={(e) => setVal(Number(e.target.value))}
                   style={{ flex: 1, accentColor: '#2FBF71' }} />
            <button type="button" onClick={() => setVal(0)}
                    style={{ background: 'none', border: 0, color: val ? '#C9D5E8' : 'transparent', fontSize: 12, padding: 0, width: 30 }}>0</button>
          </label>
        ))}
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
