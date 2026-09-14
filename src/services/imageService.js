// imageService.js — procesarea imaginilor ÎNAINTE de upload.
//
// Problema rezolvată: telefoanele moderne produc poze de 4-8 MB (4000x3000).
// Pentru o dovadă de livrare nu avem nevoie de rezoluția asta. Șase poze brute
// înseamnă 25-50 MB pe o conexiune 4G dintr-o hală — de aici venea blocarea.
//
// Rezultat țintă: 200-400 KB per poză, suficient de clar pentru dovadă.
// Documentele (CMR, Zustellprotokoll) primesc un tratament separat, mai blând,
// fiindcă acolo lizibilitatea textului e obligatorie.

export const PHOTO_PRESET = { maxEdge: 1600, quality: 0.8, mime: 'image/jpeg' }
export const DOCUMENT_PRESET = { maxEdge: 2200, quality: 0.9, mime: 'image/jpeg' }
export const THUMB_EDGE = 360

// Limite de siguranță — peste acestea refuzăm fișierul cu un mesaj clar,
// în loc să blocăm telefonul încercând să-l decodăm.
const MAX_INPUT_BYTES = 40 * 1024 * 1024
const ACCEPTED = /^image\/(jpeg|png|webp|heic|heif)$/i

export class ImageError extends Error {
  constructor(code) {
    super(code)
    this.code = code // 'too_large' | 'unsupported' | 'decode_failed'
  }
}

// createImageBitmap cu imageOrientation:'from-image' aplică rotația EXIF
// automat, deci nu mai trebuie să citim manual tagul Orientation. Safari mai
// vechi nu suportă opțiunea — fallback pe <img>, care pe iOS aplică oricum
// orientarea corect.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* cădem pe varianta cu <img> */
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ImageError('decode_failed')) }
    img.src = url
  })
}

function targetSize(w, h, maxEdge) {
  const longest = Math.max(w, h)
  if (longest <= maxEdge) return { w, h }
  const ratio = maxEdge / longest
  return { w: Math.round(w * ratio), h: Math.round(h * ratio) }
}

function draw(source, w, h) {
  // OffscreenCanvas unde există — ține treaba de desenare în afara
  // thread-ului principal, deci interfața nu se blochează la 6 poze.
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return canvas
}

async function toBlob(canvas, mime, quality) {
  if (canvas.convertToBlob) return await canvas.convertToBlob({ type: mime, quality })
  return await new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
}

/**
 * Procesează un fișier pentru upload.
 * @returns {Promise<{blob: Blob, width: number, height: number, mime: string, originalBytes: number}>}
 */
export async function processImage(file, preset = PHOTO_PRESET) {
  if (file.size > MAX_INPUT_BYTES) throw new ImageError('too_large')
  // PDF-urile trec neatinse — nu sunt imagini, nu au ce comprima aici.
  if (file.type === 'application/pdf') {
    return { blob: file, width: 0, height: 0, mime: file.type, originalBytes: file.size }
  }
  if (file.type && !ACCEPTED.test(file.type)) throw new ImageError('unsupported')

  const bitmap = await decode(file)
  const w0 = bitmap.width || bitmap.naturalWidth
  const h0 = bitmap.height || bitmap.naturalHeight
  const { w, h } = targetSize(w0, h0, preset.maxEdge)

  const canvas = draw(bitmap, w, h)
  let blob = await toBlob(canvas, preset.mime, preset.quality)
  if (bitmap.close) bitmap.close()
  if (!blob) throw new ImageError('decode_failed')

  // Dacă procesarea a ieșit mai mare decât originalul (se întâmplă la poze
  // deja mici și bine comprimate), păstrăm originalul.
  if (blob.size >= file.size && w === w0 && h === h0) {
    return { blob: file, width: w0, height: h0, mime: file.type, originalBytes: file.size }
  }
  return { blob, width: w, height: h, mime: preset.mime, originalBytes: file.size }
}

/**
 * Miniatură pentru previzualizare — mică și rapidă, ca poza să apară în grilă
 * aproape instant, fără să ținem în memorie blobul de câțiva MB.
 */
export async function makeThumbnail(file) {
  try {
    const bitmap = await decode(file)
    const w0 = bitmap.width || bitmap.naturalWidth
    const h0 = bitmap.height || bitmap.naturalHeight
    const { w, h } = targetSize(w0, h0, THUMB_EDGE)
    const blob = await toBlob(draw(bitmap, w, h), 'image/jpeg', 0.7)
    if (bitmap.close) bitmap.close()
    return blob
  } catch {
    return null
  }
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
