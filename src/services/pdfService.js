// pdfService.js — transformă poza unui document într-un PDF real.
//
// De ce fără bibliotecă: un JPEG se poate încapsula direct într-un PDF, ca
// flux DCTDecode, fără nicio recodare a imaginii. O bibliotecă de PDF ar
// adăuga câteva sute de KB în bundle pentru exact operația de mai jos.
//
// Rezultat: o pagină A4, cu poza încadrată complet, păstrând proporțiile.
// Fișierul PDF e practic de aceeași mărime ca poza — nu se recomprimă nimic,
// deci nu se pierde lizibilitate.

const A4_W = 595.28
const A4_H = 841.89

/**
 * Citește lățimea, înălțimea și numărul de canale dintr-un JPEG, direct din
 * markerul SOF. Nu decodăm imaginea — doar antetul.
 */
function readJpegHeader(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not_jpeg')
  let i = 2
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue }
    const marker = bytes[i + 1]
    // SOF0..SOF15, mai puțin DHT (C4), JPG (C8) și DAC (CC)
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSOF) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6]
      const width = (bytes[i + 7] << 8) | bytes[i + 8]
      const components = bytes[i + 9]
      return { width, height, components }
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    i += 2 + len
  }
  throw new Error('no_sof_marker')
}

const enc = new TextEncoder()

/**
 * @param {Blob} jpegBlob  poza deja procesată (redimensionată/comprimată)
 * @returns {Promise<Blob>} PDF de o pagină
 */
export async function jpegToPdf(jpegBlob) {
  const bytes = new Uint8Array(await jpegBlob.arrayBuffer())
  const { width, height, components } = readJpegHeader(bytes)
  const colorSpace = components === 1 ? '/DeviceGray' : components === 4 ? '/DeviceCMYK' : '/DeviceRGB'

  // Încadrăm imaginea în A4, păstrând proporțiile, centrată.
  const scale = Math.min(A4_W / width, A4_H / height)
  const drawW = width * scale
  const drawH = height * scale
  const offX = (A4_W - drawW) / 2
  const offY = (A4_H - drawH) / 2

  const content = `q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${offX.toFixed(2)} ${offY.toFixed(2)} cm /Im0 Do Q\n`

  const parts = []
  const offsets = []
  let length = 0

  const push = (chunk) => {
    const arr = typeof chunk === 'string' ? enc.encode(chunk) : chunk
    parts.push(arr)
    length += arr.length
  }
  const startObject = () => { offsets.push(length) }

  push('%PDF-1.4\n')
  // Comentariu binar — convenție PDF: semnalează cititorilor că fișierul
  // conține date binare și nu trebuie tratat ca text.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  startObject()
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  startObject()
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

  startObject()
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] ` +
    `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  )

  startObject()
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
    `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`
  )
  push(bytes)
  push('\nendstream\nendobj\n')

  const contentBytes = enc.encode(content)
  startObject()
  push(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`)
  push(contentBytes)
  push('endstream\nendobj\n')

  const xrefStart = length
  let xref = 'xref\n0 6\n0000000000 65535 f \n'
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)

  return new Blob(parts, { type: 'application/pdf' })
}
