// uploadQueue.js — coada de upload persistentă.
//
// Reguli (§17, §19, §40):
//  - fiecare fișier are propriul status și propriul progres;
//  - un fișier deja urcat NU se mai urcă a doua oară, niciodată;
//  - eșecul unui fișier nu anulează celelalte;
//  - 2 uploaduri simultane, nu toate odată;
//  - calea în Storage e derivată din ID-ul local stabil, deci un retry
//    suprascrie exact același obiect (idempotent, fără fișiere orfane);
//  - confirmarea etapei se poate pune în așteptare dacă nu e internet și
//    se reia automat când revine.
//
// Contractul cu restul ecosistemului rămâne NESCHIMBAT: același bucket
// 'proof-of-delivery', aceleași căi `${orderId}/${leg}/...`, același format
// jsonb `{type, name, path}` pentru documente, aceleași RPC-uri.

import { supabase } from '../supabaseClient'
import {
  STORE_FILES, STORE_CONFIRMATIONS,
  dbPut, dbGet, dbDelete, dbGetAll, dbGetByLeg, localId,
} from './db'
import { processImage, makeThumbnail, PHOTO_PRESET, DOCUMENT_PRESET } from '../services/imageService'
import { jpegToPdf } from '../services/pdfService'

const BUCKET = 'proof-of-delivery'
const MAX_CONCURRENT = 2
const MAX_ATTEMPTS = 6

// status: 'processing' | 'ready' | 'queued' | 'uploading' | 'uploaded' | 'failed' | 'confirmed'

const listeners = new Set()
let running = 0
let pumping = false

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function emit() {
  listeners.forEach((fn) => { try { fn() } catch { /* un listener rupt nu oprește coada */ } })
}

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

function extFor(mime, fallbackName) {
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime && mime.startsWith('image/')) return 'jpg'
  const fromName = (fallbackName || '').split('.').pop()
  return fromName && fromName.length <= 5 ? fromName : 'jpg'
}

/**
 * Adaugă fișiere în coadă. Întoarce imediat, cu status 'processing' —
 * previzualizarea apare din miniatură, nu din blobul original.
 */
export async function enqueueFiles(orderId, leg, files, { kind = 'photo', docType = null } = {}) {
  const created = []
  for (const file of files) {
    const id = localId()
    const preset = kind === 'document' ? DOCUMENT_PRESET : PHOTO_PRESET
    const item = {
      id, orderId, leg, kind, docType,
      fileName: file.name || `${kind}-${id}.jpg`,
      blob: null, thumb: null, mime: file.type || 'image/jpeg',
      status: 'processing', progress: 0, attempts: 0,
      remotePath: null, error: null,
      originalBytes: file.size, bytes: 0,
      createdAt: Date.now(),
    }
    await dbPut(STORE_FILES, item)
    created.push(id)
    emit()

    // Procesarea rulează în fundal, per fișier — șase poze nu mai așteaptă
    // una după alta înainte să apară ceva pe ecran.
    ;(async () => {
      try {
        const thumb = await makeThumbnail(file)
        await patch(id, { thumb })
        const processed = await processImage(file, preset)
        let blob = processed.blob
        let mime = processed.mime
        let fileName = item.fileName

        // Documentele fotografiate pleacă mai departe ca PDF, nu ca poză:
        // asta primește contabilitatea, asta se atașează unei facturi și asta
        // se deschide la fel pe orice calculator. Imaginea nu se recomprimă —
        // JPEG-ul se încapsulează direct în PDF, deci nu se pierde
        // lizibilitate și fișierul rămâne aproximativ de aceeași mărime.
        // Dacă șoferul a ales din galerie un PDF gata făcut, îl lăsăm așa.
        if (kind === 'document' && mime !== 'application/pdf') {
          try {
            blob = await jpegToPdf(blob)
            mime = 'application/pdf'
            fileName = fileName.replace(/\.[^.]+$/, '') + '.pdf'
          } catch (convErr) {
            // Conversia eșuată nu blochează dovada — urcăm poza ca atare.
            console.error('pdf conversion failed, uploading image:', convErr.message)
          }
        }

        await patch(id, { blob, mime, fileName, bytes: blob.size, status: 'queued', progress: 0 })
        pump()
      } catch (err) {
        await patch(id, { status: 'failed', error: err.code || 'process_failed' })
      }
    })()
  }
  return created
}

/** Semnătura vine deja ca Blob din pad, nu are nevoie de compresie. */
export async function enqueueSignature(orderId, leg, blob) {
  const id = localId()
  await dbPut(STORE_FILES, {
    id, orderId, leg, kind: 'signature', docType: null,
    fileName: 'signature.png', blob, thumb: blob, mime: 'image/png',
    status: 'queued', progress: 0, attempts: 0,
    remotePath: null, error: null, originalBytes: blob.size, bytes: blob.size,
    createdAt: Date.now(),
  })
  emit()
  pump()
  return id
}

async function patch(id, fields) {
  const current = await dbGet(STORE_FILES, id)
  if (!current) return null
  const next = { ...current, ...fields }
  await dbPut(STORE_FILES, next)
  emit()
  return next
}

export const listFiles = (orderId, leg) => dbGetByLeg(orderId, leg)

export async function removeFile(id) {
  await dbDelete(STORE_FILES, id)
  emit()
}

export async function retryFile(id) {
  const f = await dbGet(STORE_FILES, id)
  if (!f) return
  await patch(id, { status: f.blob ? 'queued' : 'failed', error: null, attempts: 0 })
  pump()
}

// Upload prin XHR, nu prin supabase.storage.upload — clientul JS nu expune
// progresul încărcării, iar §17 cere procent per fișier.
function uploadWithProgress(path, blob, token, onProgress) {
  return new Promise((resolve, reject) => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream')
    // x-upsert: un retry pe aceeași cale suprascrie, nu duplică.
    xhr.setRequestHeader('x-upsert', 'true')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(path)
      else reject(new Error(`storage_${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('network'))
    xhr.ontimeout = () => reject(new Error('timeout'))
    xhr.timeout = 120000
    xhr.send(blob)
  })
}

async function pump() {
  if (pumping) return
  pumping = true
  try {
    while (running < MAX_CONCURRENT) {
      if (!isOnline()) break
      const all = (await dbGetAll(STORE_FILES)) || []
      const next = all.find((f) => f.status === 'queued' && f.blob)
      if (!next) break
      running++
      void uploadOne(next).finally(() => {
        running--
        setTimeout(() => { pumping = false; pump() }, 0)
      })
    }
  } finally {
    if (running === 0) pumping = false
  }
}

async function uploadOne(item) {
  await patch(item.id, { status: 'uploading', progress: 0 })
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) throw new Error('no_session')

    const ext = extFor(item.mime, item.fileName)
    // Calea conține ID-ul local => stabilă între încercări.
    const path = `${item.orderId}/${item.leg}/${item.id}.${ext}`

    await uploadWithProgress(path, item.blob, token, (p) => { patch(item.id, { progress: p }) })
    // Blobul nu mai e necesar după ce a ajuns pe server — eliberăm spațiul,
    // dar păstrăm miniatura pentru afișare.
    await patch(item.id, { status: 'uploaded', progress: 100, remotePath: path, blob: null, error: null })
  } catch (err) {
    const attempts = (item.attempts || 0) + 1
    const failed = attempts >= MAX_ATTEMPTS
    await patch(item.id, {
      status: failed ? 'failed' : 'queued',
      attempts,
      error: err.message || 'upload_failed',
    })
    if (!failed) {
      // backoff: 2s, 4s, 8s… ca să nu batem serverul într-o buclă
      const delay = Math.min(30000, 1000 * 2 ** attempts)
      setTimeout(() => pump(), delay)
    }
  }
}

/** Sumar pentru bara de stare din interfață. */
export function summarize(files) {
  const s = { total: files.length, processing: 0, pending: 0, uploaded: 0, failed: 0 }
  for (const f of files) {
    if (f.status === 'processing') s.processing++
    else if (f.status === 'uploaded' || f.status === 'confirmed') s.uploaded++
    else if (f.status === 'failed') s.failed++
    else s.pending++
  }
  s.allDone = s.total > 0 && s.uploaded === s.total
  return s
}

// ---------------------------------------------------------------------------
// Confirmarea etapei
// ---------------------------------------------------------------------------

/**
 * Construiește exact aceiași parametri pe care îi trimite aplicația azi,
 * din fișierele deja urcate. Formatul rămâne identic pentru Disponent.
 */
export async function buildConfirmPayload(orderId, leg, signerName) {
  const files = (await dbGetByLeg(orderId, leg)) || []
  const uploaded = files.filter((f) => f.status === 'uploaded' || f.status === 'confirmed')
  return {
    p_order_id: orderId,
    p_photos: uploaded.filter((f) => f.kind === 'photo').map((f) => f.remotePath),
    p_documents: uploaded
      .filter((f) => f.kind === 'document')
      .map((f) => ({ type: f.docType || 'other', name: f.fileName, path: f.remotePath })),
    p_signature_url: uploaded.find((f) => f.kind === 'signature')?.remotePath || null,
    p_signer_name: signerName || null,
  }
}

/**
 * Confirmă etapa. Dacă nu e internet, salvează confirmarea local și o reia
 * automat mai târziu — fără să pretindă că e sincronizată (§46).
 * @returns {'synced' | 'pending'}
 */
export async function confirmLeg({ orderId, leg, rpcName, signerName }) {
  const payload = await buildConfirmPayload(orderId, leg, signerName)
  const record = { id: `${orderId}:${leg}`, orderId, leg, rpcName, payload, createdAt: Date.now() }

  if (!isOnline()) {
    await dbPut(STORE_CONFIRMATIONS, record)
    return 'pending'
  }
  const { error } = await supabase.rpc(rpcName, payload)
  if (error) {
    await dbPut(STORE_CONFIRMATIONS, record)
    throw error
  }
  await markConfirmed(orderId, leg)
  await dbDelete(STORE_CONFIRMATIONS, record.id)
  void syncDeliveryDocuments(orderId, leg)
  return 'synced'
}

async function markConfirmed(orderId, leg) {
  const files = (await dbGetByLeg(orderId, leg)) || []
  await Promise.all(files.map((f) => dbPut(STORE_FILES, { ...f, status: 'confirmed' })))
  emit()
}

// Sincronizarea către portalul de client — cu reîncercare, spre deosebire de
// varianta fire-and-forget de azi, unde un eșec trecea complet neobservat.
async function syncDeliveryDocuments(orderId, leg, attempt = 0) {
  try {
    const { data } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-delivery-documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data?.session?.access_token}` },
      body: JSON.stringify({ order_id: orderId, leg }),
    })
    if (!res.ok) throw new Error(`sync_${res.status}`)
  } catch (err) {
    if (attempt < 4) setTimeout(() => syncDeliveryDocuments(orderId, leg, attempt + 1), 5000 * 2 ** attempt)
    else console.error('sync-delivery-documents failed permanently:', err.message, { orderId, leg })
  }
}

/** Câte confirmări așteaptă internet — pentru bannerul de offline. */
export async function pendingConfirmationCount() {
  const all = (await dbGetAll(STORE_CONFIRMATIONS)) || []
  return all.length
}

async function replayPendingConfirmations() {
  if (!isOnline()) return
  const all = (await dbGetAll(STORE_CONFIRMATIONS)) || []
  for (const rec of all) {
    // Recalculăm payloadul: între timp pot fi urcate fișiere care la
    // momentul confirmării erau încă în coadă.
    const payload = await buildConfirmPayload(rec.orderId, rec.leg, rec.payload.p_signer_name)
    const { error } = await supabase.rpc(rec.rpcName, payload)
    if (!error) {
      await markConfirmed(rec.orderId, rec.leg)
      await dbDelete(STORE_CONFIRMATIONS, rec.id)
      void syncDeliveryDocuments(rec.orderId, rec.leg)
      emit()
    }
  }
}

// ---------------------------------------------------------------------------
// Pornire
// ---------------------------------------------------------------------------

let started = false
export function startQueue() {
  if (started) return
  started = true
  const resume = async () => { await requeueStuck(); pump(); replayPendingConfirmations() }
  window.addEventListener('online', resume)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resume() })
  resume()
}

// Un fișier rămas 'uploading' înseamnă că aplicația a fost închisă în timpul
// încărcării. Îl repunem în coadă — calea fiind stabilă, reluarea suprascrie
// obiectul parțial, nu creează unul nou.
async function requeueStuck() {
  const all = (await dbGetAll(STORE_FILES)) || []
  await Promise.all(
    all.filter((f) => f.status === 'uploading' && f.blob)
      .map((f) => dbPut(STORE_FILES, { ...f, status: 'queued', progress: 0 }))
  )
}
