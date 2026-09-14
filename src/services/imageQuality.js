// imageQuality.js — verifică poza unui document ÎNAINTE să plece la upload.
//
// Nu detectează marginile documentului. Detecția de contur (OpenCV/jscanify)
// a fost încercată și nu dădea rezultate de încredere; un verdict greșit e mai
// rău decât niciun verdict, fiindcă șoferul învață să-l ignore. Încadrarea o
// rezolvă ghidul afișat înainte de fotografiere.
//
// Aici verificăm doar motivele pentru care un CMR ajunge efectiv necitibil:
// poză mișcată, prea întunecată, spălăcită sau prea mică.
//
// Fără nicio bibliotecă. Rulează în câteva zecimi de secundă.
//
// Pragurile sunt calibrate pe același document fotografiat în patru variante:
//   clar           claritate 1796 · luminozitate 221 · contrast 206
//   mișcat         claritate   60
//   întunecat      luminozitate 48
//   spălăcit       contrast    37
// Sunt alese cu marjă față de valorile proaste, ca să nu semnalăm poze bune —
// un document cu puțin text pe hârtie albă are natural claritate mai mică.

const ANALYSIS_EDGE = 800

export const THRESHOLDS = {
  sharpness: 80,      // sub asta: mișcată
  brightnessMin: 70,  // sub asta: prea întunecată
  brightnessMax: 238, // peste asta: arsă de lumină
  contrast: 42,       // sub asta: spălăcită
  minEdge: 800,       // latura scurtă, în pixeli
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch { /* fallback mai jos */ }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode_failed')) }
    img.src = url
  })
}

/**
 * @returns {Promise<{ok: boolean, issues: string[], metrics: object}>}
 * issues conține chei de traducere: 'qBlurry' | 'qDark' | 'qBright' |
 * 'qFlat' | 'qSmall'
 *
 * La orice eroare întoarce ok:true — o verificare care nu a putut rula nu
 * trebuie să blocheze o dovadă validă.
 */
export async function analyzeDocumentPhoto(file) {
  const fallback = { ok: true, issues: [], metrics: null }
  if (!file || !String(file.type || '').startsWith('image/')) return fallback

  try {
    const bitmap = await decode(file)
    const W = bitmap.width || bitmap.naturalWidth
    const H = bitmap.height || bitmap.naturalHeight
    if (!W || !H) return fallback

    const scale = Math.min(1, ANALYSIS_EDGE / Math.max(W, H))
    const w = Math.max(3, Math.round(W * scale))
    const h = Math.max(3, Math.round(H * scale))

    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h })
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0, w, h)
    if (bitmap.close) bitmap.close()

    const { data } = ctx.getImageData(0, 0, w, h)

    // Gri, cu ponderile de luminanță percepută
    const gray = new Float32Array(w * h)
    const hist = new Uint32Array(256)
    let sum = 0
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      gray[p] = g
      hist[g | 0]++
      sum += g
    }
    const brightness = sum / gray.length

    // Contrast: distanța între percentila 5 și 95. Mai robust decât
    // min/max, care se duc la extreme dintr-un singur pixel.
    const total = gray.length
    let acc = 0, p5 = 0, p95 = 255
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= total * 0.05) { p5 = v; break }
    }
    acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= total * 0.95) { p95 = v; break }
    }
    const contrast = p95 - p5

    // Claritate: varianța laplacianului. O poză mișcată nu are treceri
    // bruște de luminozitate, deci varianța se prăbușește.
    let lapSum = 0, lapSumSq = 0, n = 0
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        const v = -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w]
        lapSum += v
        lapSumSq += v * v
        n++
      }
    }
    const mean = lapSum / n
    const sharpness = lapSumSq / n - mean * mean

    const issues = []
    if (Math.min(W, H) < THRESHOLDS.minEdge) issues.push('qSmall')
    if (brightness < THRESHOLDS.brightnessMin) issues.push('qDark')
    else if (brightness > THRESHOLDS.brightnessMax) issues.push('qBright')
    else if (contrast < THRESHOLDS.contrast) issues.push('qFlat')
    if (sharpness < THRESHOLDS.sharpness) issues.push('qBlurry')

    return {
      ok: issues.length === 0,
      issues,
      metrics: {
        width: W, height: H,
        sharpness: Math.round(sharpness),
        brightness: Math.round(brightness),
        contrast,
      },
    }
  } catch {
    return fallback
  }
}
