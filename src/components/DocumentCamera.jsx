// DocumentCamera.jsx — camera din aplicaţie, cu cadru şi un ghid care SFĂTUIEŞTE.
//
// Declanşatorul a fost stins până treceau toate cele şapte condiţii din
// services/documentFrame.js, de două ori la rând, pe un cadru video de 480 px
// ţinut în mână. Suna bine şi pe hârtie era corect: nu lăsa să plece o poză
// proastă. În teren a ieşit altceva — una dintre condiţii nu trecea (pe hârtie
// albă, bine luminată, „reflexia" e prima care sare), iar şoferul rămânea cu
// un buton stins, fără nicio cale spre poză. Patruzeci de secunde şi nimic.
//
// Un ghid care blochează mută decizia de la om la şapte praguri măsurate pe
// imagini generate. Acum cadrul, culoarea şi îndrumarea rămân — toate ajută
// real — dar apăsarea e a şoferului. Poza trece oricum prin verificarea de
// după, iar dacă iese slabă i se spune şi poate reface.
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


// --- căutarea foii în fotografie (OpenCV, încărcat la cerere) -------------
//
// OpenCV stă în proiect (public/vendor/opencv.js), nu pe alt server: la
// documente confidenţiale, codul care rulează pe telefon e cel livrat de noi.
// Atenţie: promisiunea NU se rezolvă cu `cv` — obiectul OpenCV are o metodă
// `then`, iar o promisiune rezolvată cu el aşteaptă la nesfârşit. Rezolvăm
// cu `true` şi luăm apoi `window.cv`.
let cvPromise = null
export function incarcaOpenCv() {
  if (window.cv?.Mat) return Promise.resolve(true)
  if (cvPromise) return cvPromise
  cvPromise = new Promise((resolve, reject) => {
    const sc = document.createElement('script')
    sc.src = '/vendor/opencv.js'
    sc.async = true
    sc.onerror = () => { cvPromise = null; reject(new Error('opencv')) }
    sc.onload = () => {
      const t0 = Date.now()
      const asteapta = () => {
        if (window.cv?.Mat) resolve(true)
        else if (Date.now() - t0 > 20000) { cvPromise = null; reject(new Error('opencv_timeout')) }
        else setTimeout(asteapta, 100)
      }
      asteapta()
    }
    document.head.appendChild(sc)
  })
  return cvPromise
}

// Unde se află, în fotografia adevărată, imaginea pe care şoferul a văzut-o
// pe ecran? Fotografia cuprinde de obicei mai mult decât filmul (alt unghi),
// deci chenarul nu se poate muta proporţional — ieşea toată podeaua.
// Căutăm cadrul video în fotografie (aceeaşi scenă, la altă scară) şi
// întoarcem transformarea. null dacă potrivirea nu e sigură.
function canvasDin(sursa, w, h, rot) {
  const c = document.createElement('canvas')
  if (rot) { c.width = h; c.height = w } else { c.width = w; c.height = h }
  const g = c.getContext('2d', { willReadFrequently: true })
  if (rot === 90) { g.translate(h, 0); g.rotate(Math.PI / 2) }
  if (rot === -90) { g.translate(0, w); g.rotate(-Math.PI / 2) }
  g.drawImage(sursa, 0, 0, w, h)
  return c
}

export async function potrivesteFotografia(foto, cadru) {
  try { await incarcaOpenCv() } catch { return null }
  const cv = window.cv
  const vW = cadru.width, vH = cadru.height
  const portretV = vH >= vW
  const rotiri = ((foto.height >= foto.width) === portretV) ? [0] : [90, -90]
  const P = 480
  let best = null
  for (const rot of rotiri) {
    const fW = rot ? foto.height : foto.width
    const fH = rot ? foto.width : foto.height
    const sP = P / fW
    const mica = canvasDin(foto, Math.round(foto.width * sP), Math.round(foto.height * sP), rot)
    const de = []
    try {
      const imgF = cv.imread(mica); de.push(imgF)
      const grF = new cv.Mat(); de.push(grF)
      cv.cvtColor(imgF, grF, cv.COLOR_RGBA2GRAY)
      // Două treceri: grosier (pas 0,025), apoi fin (0,005) în jurul celei mai bune scări.
      const scari = []
      for (let f = 0.5; f <= 1.0001; f += 0.025) scari.push(f)
      const incearca = (lista) => { for (const f of lista) {
        const tw = Math.round(P * f)
        const th = Math.round(tw * vH / vW)
        if (th > mica.height || tw < 40) continue
        const tpl = document.createElement('canvas')
        tpl.width = tw; tpl.height = th
        tpl.getContext('2d', { willReadFrequently: true }).drawImage(cadru, 0, 0, tw, th)
        const imgT = cv.imread(tpl)
        const grT = new cv.Mat()
        cv.cvtColor(imgT, grT, cv.COLOR_RGBA2GRAY)
        const res = new cv.Mat()
        cv.matchTemplate(grF, grT, res, cv.TM_CCOEFF_NORMED)
        const mm = cv.minMaxLoc(res)
        if (!best || mm.maxVal > best.scor) {
          best = { scor: mm.maxVal, rot, x: mm.maxLoc.x / sP, y: mm.maxLoc.y / sP, scara: (tw / sP) / vW, fW, fH }
        }
        imgT.delete(); grT.delete(); res.delete()
      } }
      incearca(scari)
      if (best && best.rot === rot) {
        const f0 = (best.scara * vW) * sP / P
        const fine = []
        for (let f = f0 - 0.03; f <= f0 + 0.03; f += 0.005) if (f > 0.3 && f <= 1.0001) fine.push(f)
        incearca(fine)
      }
    } catch {
      /* încercăm mai departe */
    } finally {
      de.forEach((m) => { try { m.delete() } catch { /* nimic */ } })
    }
  }
  if (!best || best.scor < 0.55) return null
  return best
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
  // După câteva secunde fără cadru bun, arătăm pe ecran şi ieşirea pe camera
  // telefonului, plus ce anume nu trece — altfel şoferul nu are de unde şti
  // dacă încearcă degeaba sau mai are un milimetru.
  const [seChinuie, setSeChinuie] = useState(false)
  // Dimensiunea imaginii de la cameră. Chenarul desenat pe ecran trebuie să
  // fie ACELAŞI cu cel măsurat — altfel şoferul potriveşte documentul într-un
  // dreptunghi, iar verdictul vine din altul. De aceea nu scriem procente
  // fixe: le calculăm din imagine, cu aceeaşi funcţie.
  const [dim, setDim] = useState(null)

  // OpenCV se încarcă din clipa în care se deschide camera, ca la apăsare
  // să fie gata (fişierul e mare, ~9 MB, dar rămâne apoi în cache).
  useEffect(() => { incarcaOpenCv().catch(() => {}) }, [])

  // --- camera -------------------------------------------------------------
  useEffect(() => {
    let viu = true
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setEroare('unsupported'); return }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            // Cât mai mare: dacă telefonul nu ştie să facă o fotografie
            // adevărată (vezi `pozaIntreaga`), poza vine din cadrul video.
            width: { ideal: 2160 },
            height: { ideal: 2880 },
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

  useEffect(() => {
    if (gata) { setSeChinuie(false); return }
    const t2 = setTimeout(() => setSeChinuie(true), 7000)
    return () => clearTimeout(t2)
  }, [gata])

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
  //
  // Scrisul ieşea neclar (17.10.2026): poza se lua dintr-un cadru VIDEO —
  // rezoluţie mică, comprimat ca film. Prima încercare a cerut o fotografie
  // adevărată (ImageCapture), dar fotografia are alt unghi de cuprindere decât
  // filmul de pe ecran: chenarul nu se mai potrivea şi ieşea podeaua întreagă.
  //
  // Acum: fotografia adevărată, iar chenarul de pe ecran e căutat în ea
  // (potrivirea filmului în fotografie), deci se decupează exact ce a văzut
  // şoferul în chenar, dar la rezoluţia fotografiei. Dacă potrivirea nu e
  // sigură, se ia ca înainte chenarul din cadrul video (cerut acum la
  // rezoluţie mai mare). Şoferul vede rezultatul şi poate reface poza.
  async function pozaIntreaga() {
    const track = streamRef.current?.getVideoTracks?.()[0]
    if (!track || typeof window.ImageCapture !== 'function') return null
    try {
      const ic = new window.ImageCapture(track)
      const blob = await ic.takePhoto()
      if (!blob) return null
      return await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(blob))
    } catch {
      return null
    }
  }

  function decupajChenarVideo(v) {
    const ch = chenarGhid(v.videoWidth, v.videoHeight)
    const m = Math.round(Math.min(ch.w, ch.h) * 0.03)
    const sx = Math.max(0, Math.round(ch.x - m))
    const sy = Math.max(0, Math.round(ch.y - m))
    const sw = Math.min(v.videoWidth - sx, Math.round(ch.w + 2 * m))
    const sh = Math.min(v.videoHeight - sy, Math.round(ch.h + 2 * m))
    const out = document.createElement('canvas')
    out.width = sw
    out.height = sh
    const g = out.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh)
    return out
  }

  async function fotografiaza() {
    const v = videoRef.current
    if (!v || !v.videoWidth || lucreaza) return
    setLucreaza(true)
    try {
      // Cadrul video exact din clipa apăsării — e ce a văzut şoferul.
      const cadru = document.createElement('canvas')
      cadru.width = v.videoWidth
      cadru.height = v.videoHeight
      cadru.getContext('2d').drawImage(v, 0, 0)
      const rezerva = decupajChenarVideo(v)
      let out = null
      const foto = await pozaIntreaga()
      if (foto) {
        const m = await potrivesteFotografia(foto, cadru)
        if (m) {
          // Chenarul de pe ecran, mutat în fotografie (cu marginea de 3%).
          const ch = chenarGhid(v.videoWidth, v.videoHeight)
          const marg = Math.min(ch.w, ch.h) * 0.03
          const x0 = m.x + (ch.x - marg) * m.scara
          const y0 = m.y + (ch.y - marg) * m.scara
          const w0 = (ch.w + 2 * marg) * m.scara
          const h0 = (ch.h + 2 * marg) * m.scara
          const sx = Math.max(0, Math.round(x0)), sy = Math.max(0, Math.round(y0))
          const sw = Math.min(m.fW - sx, Math.round(w0)), sh = Math.min(m.fH - sy, Math.round(h0))
          if (sw > rezerva.width && sh > rezerva.height) {
            const intreaga = canvasDin(foto, foto.width, foto.height, m.rot)
            out = document.createElement('canvas')
            out.width = sw
            out.height = sh
            const g = out.getContext('2d')
            g.imageSmoothingQuality = 'high'
            g.drawImage(intreaga, sx, sy, sw, sh, 0, 0, sw, sh)
          }
        }
        if (foto.close) foto.close()
      }
      // Fără fotografie (iPhone) sau potrivire nesigură: exact chenarul din film.
      out = out || rezerva
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

        {/* Nu se încadrează. Îi spunem că poate apăsa oricum, îi dăm camera
            telefonului, şi scriem ce anume nu trece — cuvintele acelea sunt
            singurul fel în care aflăm, de la distanţă, care prag greşeşte. */}
        {seChinuie && !gata && (
          <div style={{ marginTop: 9 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.8)', lineHeight: 1.5, maxWidth: 420, margin: '0 auto' }}>
              {t('frameStuckNote', lang)}
            </div>
            <button
              type="button"
              onClick={onSystemCamera}
              style={{
                marginTop: 8, background: 'transparent',
                border: '1px solid rgba(255,255,255,.45)', color: '#fff',
                borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('frameUseSystem', lang)}
            </button>
            {verdict?.issues?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 10.5, color: 'rgba(255,255,255,.45)', letterSpacing: 0.2, lineHeight: 1.5 }}>
                <div>{verdict.issues.join(' · ')}</div>
                {/* Măsurătorile, nu doar numele verificării. Cu „frameNoPaper"
                    singur nu se poate şti CARE din cele două semne lipseşte;
                    cu cifrele de aici se vede pe loc. */}
                {verdict.metrics && (
                  <div>
                    sep {verdict.metrics.separare} · umpl {verdict.metrics.umplere}
                    {' · '}prag {verdict.metrics.prag} · clar {verdict.metrics.claritate}
                    {' · '}contr {verdict.metrics.contrast} · lum {verdict.metrics.lumina}
                    {' · '}refl {verdict.metrics.reflexie}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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

        {/* Declanşatorul: mereu apăsabil. Verde când cadrul e bun, alb când
            nu — culoarea spune ce crede ghidul, apăsarea rămâne a şoferului.
            Stins, era singura cale către poză pentru hârtiile obligatorii:
            dacă una din şapte condiţii nu trecea, cursa se oprea acolo. */}
        <button
          type="button"
          onClick={fotografiaza}
          disabled={lucreaza}
          style={{
            flex: 1, borderRadius: 12, border: 'none', padding: '14px 16px',
            background: gata ? '#2FBF71' : 'rgba(255,255,255,.92)',
            color: gata ? '#06220F' : '#0F2240',
            fontSize: 15.5, fontWeight: 800,
            cursor: 'pointer',
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
