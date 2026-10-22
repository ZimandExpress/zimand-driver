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
// Fişierele care se urcă ACUM, în pagina asta. La revenirea în aplicaţie,
// requeueStuck le repunea în coadă chiar dacă urcarea mergea încă — aceeaşi
// poză pornea a doua oară în paralel şi ocupa locul alteia.
const inFlight = new Set()

// Semnal slab: telefonul spune „online", dar nu trece nimic. O urcare fără
// niciun progres atâta timp e oprită şi reluată, în loc să aştepte minute.
const STALL_MS = 20000
// Erorile de reţea nu duc niciodată la „eşuat": poza aşteaptă semnalul şi se
// reia singură. Pauza între încercări rămâne scurtă, ca la revenirea
// semnalului să plece în câteva secunde, nu peste un minut.
const NETWORK_RETRY_MAX_MS = 8000
const eroareDeRetea = (msg) => /^(network|timeout|stalled|no_session)$/.test(msg || '') || /^storage_(0|408|429|5\d\d)$/.test(msg || '')

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
  await patch(id, { status: f.blob ? 'queued' : 'failed', error: null, attempts: 0, nextTryAt: null })
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
    let ultimulSemn = Date.now()
    let oprit = false
    // Paznicul: dacă n-a mai trecut niciun octet de STALL_MS, oprim şi
    // încercăm din nou. Pe semnal slab o conexiune poate rămâne agăţată
    // minute întregi fără să cadă.
    const paznic = setInterval(() => {
      if (Date.now() - ultimulSemn > STALL_MS) {
        oprit = true
        clearInterval(paznic)
        try { xhr.abort() } catch { /* deja închisă */ }
        reject(new Error('stalled'))
      }
    }, 2000)
    const gata = () => clearInterval(paznic)
    xhr.upload.onprogress = (e) => {
      ultimulSemn = Date.now()
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      gata()
      if (xhr.status >= 200 && xhr.status < 300) resolve(path)
      else reject(new Error(`storage_${xhr.status}`))
    }
    xhr.onerror = () => { gata(); if (!oprit) reject(new Error('network')) }
    xhr.ontimeout = () => { gata(); if (!oprit) reject(new Error('timeout')) }
    xhr.onabort = () => { gata(); if (!oprit) reject(new Error('network')) }
    // Limita totală doar ca plasă de siguranţă pentru PDF-uri mari pe
    // conexiuni lente: oprirea reală o face paznicul de mai sus.
    xhr.timeout = 300000
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
      // nextTryAt: pauza după o încercare căzută. Fără ea, poza se reîncerca
      // imediat, în buclă, cât timp nu era semnal — baterie consumată degeaba.
      const acum = Date.now()
      const next = all.find((f) => f.status === 'queued' && f.blob && !inFlight.has(f.id) && !(f.nextTryAt > acum))
      if (!next) break
      running++
      void uploadOne(next).finally(() => {
        running--
        setTimeout(() => { pumping = false; pump() }, 0)
      })
    }
  } finally {
    if (running === 0) {
      pumping = false
      // Dovezile au ajuns sus — acum e momentul confirmărilor care aşteptau
      // după ele. Fără asta, reluarea se încerca o singură dată, la revenirea
      // semnalului, când pozele abia porneau: le sărea pe toate şi nimic n-o
      // mai chema înapoi. Confirmarea rămânea pe telefon până când şoferul
      // închidea şi redeschidea aplicaţia.
      if (!reluareInCurs) setTimeout(() => { void replayPendingConfirmations() }, 0)
    }
  }
}

async function uploadOne(item) {
  inFlight.add(item.id)
  await patch(item.id, { status: 'uploading', progress: 0 })
  try {
    // Cu tokenul expirat, getSession îl reînnoieşte întâi pe server — iar pe
    // semnal slab cererea aceea putea atârna fără sfârşit, cu poza blocată
    // pe „se urcă". O limităm şi reîncercăm.
    const { data } = await Promise.race([
      supabase.auth.getSession(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('no_session')), 15000)),
    ])
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
    const retea = eroareDeRetea(err.message)
    // Doar un refuz real al serverului (fişier respins, drepturi) poate
    // marca poza drept eşuată. Lipsa semnalului nu: poza rămâne în coadă
    // şi pleacă singură când trece din nou ceva.
    const failed = !retea && attempts >= MAX_ATTEMPTS
    // Pauza se scrie odată cu starea: altfel coada ar putea lua poza din nou
    // în intervalul dintre cele două scrieri.
    const delayPrevazut = Math.min(retea ? NETWORK_RETRY_MAX_MS : 30000, 1000 * 2 ** Math.min(attempts, 5))
    await patch(item.id, {
      status: failed ? 'failed' : 'queued',
      attempts,
      error: err.message || 'upload_failed',
      nextTryAt: failed ? null : Date.now() + delayPrevazut,
    })
    if (!failed) {
      // backoff: 2s, 4s, 8s… ca să nu batem serverul într-o buclă
      const delay = Math.min(retea ? NETWORK_RETRY_MAX_MS : 30000, 1000 * 2 ** Math.min(attempts, 5))
      setTimeout(() => pump(), delay + 50)
    }
  } finally {
    inFlight.delete(item.id)
  }
}

/** Sumar pentru bara de stare din interfață. */
export function summarize(files) {
  // Fişele pierdute se numără separat: nu se pot urca niciodată, deci nu au
  // voie să ţină confirmarea blocată. Şoferul vede că lipsesc şi reface poza.
  const pierdute = files.filter((f) => f.status === 'lost').length
  files = files.filter((f) => f.status !== 'lost')
  const s = { total: files.length, processing: 0, pending: 0, uploaded: 0, failed: 0, lost: pierdute }
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
export async function buildConfirmPayload(orderId, leg, signerName, extra = null) {
  const files = (await dbGetByLeg(orderId, leg)) || []
  const uploaded = files.filter((f) => f.status === 'uploaded' || f.status === 'confirmed')
  return {
    p_order_id: orderId,
    // `.filter(Boolean)`: o fişă ştampilată „urcat" fără cale ar fi pus un
    // element gol în `trip_stops.photos`, iar galeria dispeceratului ar fi
    // încercat să ceară o adresă semnată pentru nimic.
    p_photos: uploaded.filter((f) => f.kind === 'photo').map((f) => f.remotePath).filter(Boolean),
    p_documents: uploaded
      .filter((f) => f.kind === 'document')
      .map((f) => ({ type: f.docType || 'other', name: f.fileName, path: f.remotePath })),
    p_signature_url: uploaded.find((f) => f.kind === 'signature')?.remotePath || null,
    p_signer_name: signerName || null,
    // Parametri în plus, pentru opririle unui tur: `p_stop_id`. Etapele
    // obişnuite (ridicare, livrare, retur) nu trimit nimic aici, deci forma
    // pe care o primeşte Disponent rămâne neschimbată.
    ...(extra || {}),
  }
}

/**
 * Confirmă etapa. Dacă nu e internet, salvează confirmarea local și o reia
 * automat mai târziu — fără să pretindă că e sincronizată (§46).
 * @returns {'synced' | 'pending'}
 */
export async function confirmLeg({ orderId, leg, rpcName, signerName, extraPayload = null }) {
  // Întâi aşteptăm dovezile. O confirmare fără semnătură sau fără o poză nu e
  // o confirmare — e o cursă care pare dovedită şi nu e.
  const totSus = await asteaptaDovezile(orderId, leg)
  const payload = await buildConfirmPayload(orderId, leg, signerName, extraPayload)
  // `extra` se păstrează pe fişa de aşteptare: la reluarea de mai târziu
  // payloadul se reconstruieşte, iar fără el id-ul opririi s-ar pierde şi
  // confirmarea ar pleca spre nicăieri.
  const record = { id: `${orderId}:${leg}`, orderId, leg, rpcName, payload, extra: extraPayload, createdAt: Date.now() }

  // Fără internet SAU cu o dovadă încă pe telefon: punem confirmarea în
  // aşteptare, întreagă. La reluare payloadul se reconstruieşte, deci pleacă
  // cu tot ce a ajuns între timp.
  // Întâi scriem fişa nouă, pe urmă o ştergem pe cea soră. Invers, o
  // aplicaţie închisă între cele două gesturi rămânea fără niciuna.
  if (!isOnline() || !totSus) {
    await dbPut(STORE_CONFIRMATIONS, record)
    await dbDelete(STORE_CONFIRMATIONS, `${orderId}:${leg}:esec`)
    emit()
    return 'pending'
  }
  const { error } = await supabase.rpc(rpcName, payload)
  if (error) {
    // Nu orice eşec merită reîncercat la infinit.
    //
    // Un refuz al serverului (drepturi, un declanşator care spune „turul are
    // opriri neîncheiate") va fi refuzat şi mâine. Pus în aşteptare, se
    // reîncerca la fiecare deschidere a aplicaţiei, pentru totdeauna, fără ca
    // nimeni să afle. Doar căderile trecătoare se păstrează.
    if (eroareTrecatoare(error)) {
      // Cădere trecătoare (semnalul a pâlpâit o clipă): confirmarea e deja pusă
      // în coadă şi pleacă singură la revenirea reţelei. O raportăm ca 'pending',
      // NU ca eşec — aşa şoferul vede „salvat, se trimite automat", nu un buton
      // care pare mort. Exact cazul în care marfa era livrată, dar apăsarea
      // părea că nu face nimic.
      await dbPut(STORE_CONFIRMATIONS, record)
      await dbDelete(STORE_CONFIRMATIONS, `${orderId}:${leg}:esec`)
      emit()
      return 'pending'
    }
    // Un refuz care nu se reia (drepturi, un declanşator) lasă lucrurile EXACT
    // cum erau — îl aflăm, nu-l ascundem.
    throw error
  }
  await markConfirmed(orderId, leg)
  await dbDelete(STORE_CONFIRMATIONS, record.id)
  await dbDelete(STORE_CONFIRMATIONS, `${orderId}:${leg}:esec`)
  void syncDeliveryDocuments(orderId, leg)
  return 'synced'
}

/**
 * Un RPC „însoţitor" al confirmării: poziţia GPS şi modul de livrare.
 *
 * DE CE EXISTĂ. Acestea se scriau direct cu `supabase.rpc(...)` chiar în clipa
 * bifei, în afara cozii. Fără semnal (subsol, sat), apelul cădea cu o eroare
 * doar scrisă în consolă, iar confirmarea — care MERGE în coadă — pleca mai
 * târziu fără ele. Poziţia e „singura dovadă că şoferul a fost la adresă", deci
 * nu are voie să se piardă aşa.
 *
 * Citirea GPS se face tot la bifă (merge şi offline); AICI doar punem apelul,
 * cu valorile îngheţate, în aceeaşi coadă. Se reia singur până reuşeşte, fără
 * să blocheze confirmarea (sunt coloane separate, ordinea nu contează).
 * Funcţiile sunt idempotente — doar setează coloane — deci o reluare e sigură.
 *
 * @returns {'synced' | 'pending'}
 */
export async function enqueueSideRpc(orderId, leg, rpcName, args, suffix) {
  const record = {
    id: `${orderId}:${leg}:${suffix}`,
    orderId, leg, fel: 'siderpc', rpcName, payload: args, createdAt: Date.now(),
  }
  if (!isOnline()) {
    await dbPut(STORE_CONFIRMATIONS, record)
    emit()
    return 'pending'
  }
  const { error } = await supabase.rpc(rpcName, args)
  if (error) {
    if (eroareTrecatoare(error)) {
      await dbPut(STORE_CONFIRMATIONS, record)
      emit()
      return 'pending'
    }
    // Refuz care nu se reia: îl păstrăm marcat `giveUp` (vizibil în banner), nu-l
    // pierdem în tăcere cum se întâmpla înainte.
    await dbPut(STORE_CONFIRMATIONS, { ...record, attempts: 1, lastError: error.message || String(error), giveUp: true })
    emit()
    return 'pending'
  }
  return 'synced'
}

/**
 * Raportează o oprire ca „nu s-a putut" — şi fără internet.
 *
 * DE CE EXISTĂ. Până acum raportul pleca direct către server. Dacă nu era
 * semnal, apăsarea cădea cu o eroare şi atât: oprirea rămânea deschisă, iar
 * şoferul — care fusese acolo, scrisese motivul şi făcuse poza — trebuia să
 * ţină minte să se întoarcă la ea. Dacă nu se întorcea, turul nu se mai
 * putea încheia (baza nu lasă o comandă să plece livrată cu opriri fără
 * dovadă) şi nimeni nu ştia de ce.
 *
 * Pozele mergeau deja în coadă şi urcau singure. Doar motivul rămânea agăţat
 * de semnal. Acum intră în aceeaşi coadă ca o confirmare şi pleacă singur,
 * cu pozele care au ajuns între timp.
 *
 * @returns {'synced' | 'pending'}
 */
export async function reportStopFailed({ orderId, stopId, reason }) {
  const motiv = String(reason || '').trim()
  if (!orderId || !stopId || !motiv) throw new Error('reportStopFailed: date lipsă')

  const record = {
    id: `${orderId}:${stopId}:esec`, fel: 'esec',
    orderId, leg: stopId, reason: motiv,
    rpcName: 'driver_stop_failed', payload: null, createdAt: Date.now(),
  }

  // O confirmare a aceleiaşi opriri rămasă în aşteptare se şterge numai când
  // se ştie că raportul a luat locul ei — ori plecat, ori pus la coadă.
  //
  // Ştearsă din prima, cum era, un refuz care nu merită reluat (un token
  // expirat, de pildă) o arunca fără să pună nimic în loc: semnătura strânsă
  // la oprirea aceea dispărea de pe telefon, raportul nu pleca, iar şoferul
  // vedea doar „nu s-a putut salva".
  const iaLocul = async () => { await dbDelete(STORE_CONFIRMATIONS, `${orderId}:${stopId}`) }
  const puneSiIaLocul = async () => {
    await dbPut(STORE_CONFIRMATIONS, record)
    await iaLocul()
  }

  // Întâi aşteptăm poza. Serverul scrie `photos` peste ce era, fără să
  // întrebe, deci un raport plecat înainte ca poza să urce o şterge definitiv
  // — exact poza pe care aplicaţia o cere obligatoriu înainte de a lăsa
  // şoferul să raporteze. Dacă nu ajunge la timp, raportul aşteaptă pe
  // telefon şi pleacă întreg mai târziu, ca o confirmare.
  const totSus = await asteaptaDovezile(orderId, stopId, { timeoutMs: 8000, doarPoze: true })

  if (!isOnline() || !totSus) {
    await puneSiIaLocul()
    emit()
    return 'pending'
  }

  const { error } = await supabase.rpc('driver_stop_failed', payloadEsec(orderId, stopId, motiv, await dbGetByLeg(orderId, stopId)))
  if (error) {
    // Semnal slab, server picat: raportul rămâne pe telefon şi pleacă singur.
    // Pentru şofer asta NU e un eşec — e exact ce trebuie să se întâmple — şi
    // nu mai are de ce să afle o eroare. Înainte fişa se punea la coadă şi
    // tot se arunca o eroare: raportul ajungea mai târziu, dar şoferul
    // plecase de la uşă convins că nu s-a salvat nimic.
    if (eroareTrecatoare(error)) {
      await puneSiIaLocul()
      emit()
      return 'pending'
    }
    throw error
  }
  await iaLocul()
  await markConfirmed(orderId, stopId, { doarPoze: true })
  emit()
  return 'synced'
}

/**
 * Raportează livrarea ca „nu s-a putut" (firmă închisă, nimeni acasă…).
 *
 * Acelaşi drum ca la o oprire ratată: aşteaptă poza, iar fără semnal raportul
 * rămâne pe telefon şi pleacă singur. `key` e cheia sub care stau pozele
 * încercării — una nouă la fiecare încercare, ca pozele de la prima uşă
 * închisă să nu se amestece cu cele de la a doua.
 *
 * @returns {'synced' | 'pending'}
 */
export async function reportDeliveryFailed({ orderId, etapa, key, reason }) {
  const motiv = String(reason || '').trim()
  if (!orderId || !key || !motiv) throw new Error('reportDeliveryFailed: date lipsă')
  const record = {
    id: `${orderId}:${key}:versuch`, fel: 'versuch',
    orderId, leg: key, etapa: etapa || 'delivery', reason: motiv,
    rpcName: 'driver_delivery_failed', payload: null, createdAt: Date.now(),
  }
  const totSus = await asteaptaDovezile(orderId, key, { timeoutMs: 8000, doarPoze: true })
  if (!isOnline() || !totSus) {
    await dbPut(STORE_CONFIRMATIONS, record)
    emit()
    return 'pending'
  }
  const { error } = await supabase.rpc('driver_delivery_failed', payloadVersuch(record, await dbGetByLeg(orderId, key)))
  if (error) {
    if (eroareTrecatoare(error)) {
      await dbPut(STORE_CONFIRMATIONS, record)
      emit()
      return 'pending'
    }
    throw error
  }
  await markConfirmed(orderId, key, { doarPoze: true })
  emit()
  return 'synced'
}

function payloadVersuch(rec, fisiere) {
  const poze = (fisiere || [])
    .filter((f) => f.kind === 'photo' && (f.status === 'uploaded' || f.status === 'confirmed'))
    .map((f) => f.remotePath)
    .filter(Boolean)
  return { p_order_id: rec.orderId, p_leg: rec.etapa || 'delivery', p_reason: rec.reason, p_photos: poze }
}

// Forma pe care o aşteaptă `driver_stop_failed`. Scoasă aparte fiindcă se
// construieşte în două locuri: la apăsare şi la reluarea de mai târziu —
// unde pozele pot fi mai multe decât erau atunci.
function payloadEsec(orderId, stopId, motiv, fisiere) {
  const poze = (fisiere || [])
    .filter((f) => f.kind === 'photo' && (f.status === 'uploaded' || f.status === 'confirmed'))
    .map((f) => f.remotePath)
    .filter(Boolean)
  return { p_stop_id: stopId, p_reason: motiv, p_photos: poze }
}

async function markConfirmed(orderId, leg, { doarPoze = false } = {}) {
  const files = (await dbGetByLeg(orderId, leg)) || []
  await Promise.all(files.map((f) => {
    // Ştampila spune „a ajuns unde trebuia". La un raport „nu s-a putut",
    // semnătura şi actele n-au ajuns nicăieri: serverul nu le scrie. Puse
    // sub aceeaşi ştampilă, le-ar fi şters `pruneOld` după şapte zile ca pe
    // nişte dovezi predate.
    if (doarPoze && f.kind !== 'photo') return Promise.resolve()
    // Se ştampilează DOAR ce a ajuns într-adevăr sus.
    //
    // Prima oară condiţia cerea să mai aibă conţinut: un fişier care încă are
    // blob n-a plecat de pe telefon, iar ştampilat „confirmat" coada nu-l mai
    // ia niciodată — ea caută doar 'queued' — şi după şapte zile `pruneOld`
    // îl şterge. Dar lăsa pe dinafară tocmai fişele FĂRĂ conţinut şi fără
    // cale: una pierdută, sau una prinsă în prelucrare. Alea primeau ştampila
    // şi apoi se socoteau urcate peste tot.
    if (f.status !== 'uploaded' && f.status !== 'confirmed') return Promise.resolve()
    return dbPut(STORE_FILES, { ...f, status: 'confirmed' })
  }))
  emit()
}

/**
 * Aşteaptă ca dovezile etapei să ajungă sus (sau să eşueze definitiv).
 *
 * De ce există: semnătura se punea în coadă şi se construia payloadul în
 * aceeaşi răsuflare. Payloadul ia doar fişierele cu starea 'uploaded', iar
 * semnătura era încă 'queued' — aşa că `p_signature_url` plecaa null, de
 * fiecare dată. Numele semnatarului se salva, semnătura nu: în baza de
 * producţie, 83 din 95 de livrări confirmate aveau nume şi nicio semnătură.
 *
 * Întoarce `true` dacă totul e sus, `false` dacă s-a scurs timpul sau nu e
 * internet — iar atunci confirmarea se pune în aşteptare, întreagă, în loc să
 * plece ciuntită.
 */
/**
 * Mai e vreo dovadă pe drum pentru etapa asta?
 *
 * „Pe drum" înseamnă că poate ajunge singură: aşteaptă la rând, se prelucrează
 * sau tocmai urcă. O fişă pierdută sau una la care coada a renunţat NU se
 * socoteşte — ea nu mai pleacă nici peste o oră, iar aşteptată, ar ţine
 * confirmarea pe telefon pentru totdeauna.
 */
async function dovezInZbor(orderId, leg) {
  const files = (await dbGetByLeg(orderId, leg)) || []
  return files.some((f) => f.status === 'queued' || f.status === 'processing' || f.status === 'uploading')
}

async function asteaptaDovezile(orderId, leg, { timeoutMs = 25000, doarPoze = false } = {}) {
  const totSus = async () => {
    const files = (await dbGetByLeg(orderId, leg)) || []
    return files
      .filter((f) => f.status !== 'lost')
      // La un raport „nu s-a putut" serverul scrie doar pozele. A aştepta şi
      // semnătura ar ţine şoferul în faţa unei uşi închise pentru un fişier
      // pe care nimeni nu-l va citi.
      .filter((f) => !doarPoze || f.kind === 'photo')
      .every((f) => f.status === 'uploaded' || f.status === 'confirmed')
  }
  const pana = Date.now() + timeoutMs
  while (true) {
    if (await totSus()) return true
    if (!isOnline() || Date.now() > pana) return false
    pump()
    await new Promise((r) => setTimeout(r, 400))
  }
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

// Căderi trecătoare: reţea, timp depăşit, erori de server. Un refuz al
// serverului (4xx, mesaj de la un declanşator) nu e trecător.
function eroareTrecatoare(error) {
  const cod = String(error?.code || '')
  const mesaj = String(error?.message || '').toLowerCase()
  if (/^5\d\d$/.test(cod)) return true
  if (cod === '' && /fetch|network|timeout|failed to fetch|load failed/.test(mesaj)) return true
  if (/^(08|53|57|58)/.test(cod)) return true   // conexiune, resurse, operator intervention
  return false
}

const MAX_REPLAY = 8
// De câte ori la rând poate fi amânată o fişă fiindcă dovezile ei nu sunt
// încă sus. Cu reluarea chemată la golirea cozii, o urcare normală ia una
// sau două runde; treizeci înseamnă că nu mai urcă niciodată.
const MAX_ASTEPTARI = 30
// Reluarea nu se cheamă pe ea însăşi: `pump()` din interiorul ei ar porni o
// a doua rundă peste prima, iar aceeaşi fişă ar pleca de două ori.
let reluareInCurs = false

/** Câte confirmări așteaptă internet — pentru bannerul de offline. */
export async function pendingConfirmationCount() {
  const all = (await dbGetAll(STORE_CONFIRMATIONS)) || []
  return all.filter((r) => !r.giveUp).length
}

/**
 * Starea confirmărilor nelivrate: câte aşteaptă şi câte s-au oprit.
 *
 * Până acum nimic nu le arăta. O confirmare pe care serverul a refuzat-o de
 * opt ori primeşte `giveUp` — ca să nu se reia la infinit — şi de acolo
 * încolo nu mai apărea nicăieri: nici la server, nici pe ecran. O livrare
 * cu semnătură putea rămâne pe telefon fără ca nimeni să afle. Numărul de
 * mai jos e cel pe care îl arată bannerul din lista de curse.
 */
export async function confirmationsStatus() {
  const all = (await dbGetAll(STORE_CONFIRMATIONS)) || []
  return {
    asteapta: all.filter((r) => !r.giveUp).length,
    blocate: all.filter((r) => r.giveUp).length,
    primaEroare: (all.find((r) => r.giveUp) || {}).lastError || null,
  }
}

/** Dă încă o şansă confirmărilor oprite — pentru butonul din banner. */
export async function retryStuckConfirmations() {
  const all = (await dbGetAll(STORE_CONFIRMATIONS)) || []
  await Promise.all(all.filter((r) => r.giveUp)
    .map((r) => dbPut(STORE_CONFIRMATIONS, { ...r, giveUp: false, attempts: 0 })))
  emit()
  await replayPendingConfirmations()
}

/**
 * Şterge o confirmare rămasă în aşteptare.
 *
 * Cazul real: la o oprire, confirmarea a eşuat şi a rămas în aşteptare; apoi
 * şoferul a raportat oprirea ca „nu s-a putut". Fără ştergere, reluarea ar
 * trimite mai târziu confirmarea — şi oprirea ar ajunge şi confirmată şi
 * ratată, ceea ce baza refuză (sau, mai rău, ar şterge motivul eşecului).
 */
export async function cancelPendingConfirmation(orderId, leg) {
  await dbDelete(STORE_CONFIRMATIONS, `${orderId}:${leg}`)
  emit()
}

async function replayPendingConfirmations() {
  if (!isOnline() || reluareInCurs) return
  reluareInCurs = true
  try {
    await ruleazaReluarea()
  } finally {
    reluareInCurs = false
  }
}

async function ruleazaReluarea() {
  const all = (await dbGetAll(STORE_CONFIRMATIONS)) || []
  for (const rec of all) {
    if (rec.giveUp) continue
    // RPC însoţitor (poziţie GPS / mod de livrare): nu depinde de fişiere, deci
    // nu aşteaptă dovezile — pleacă de îndată ce e semnal şi se şterge la reuşită.
    if (rec.fel === 'siderpc') {
      const { error } = await supabase.rpc(rec.rpcName, rec.payload)
      if (!error) {
        await dbDelete(STORE_CONFIRMATIONS, rec.id)
        emit()
        continue
      }
      const incercari = (rec.attempts || 0) + 1
      if (!eroareTrecatoare(error) || incercari >= MAX_REPLAY) {
        await dbPut(STORE_CONFIRMATIONS, { ...rec, attempts: incercari, lastError: error.message || String(error), giveUp: true })
      } else {
        await dbPut(STORE_CONFIRMATIONS, { ...rec, attempts: incercari, lastError: error.message || String(error) })
      }
      emit()
      continue
    }
    // Două feluri de fişe aşteaptă aici: confirmări de etapă şi rapoarte
    // „nu s-a putut". Se reiau pe acelaşi drum, dar nu cu acelaşi payload —
    // iar o fişă veche, scrisă înainte să existe al doilea fel, n-are `fel`
    // şi e o confirmare, ca până acum.
    // „versuch" = o livrare raportată „nu s-a putut"; se poartă ca un „esec".
    const esteVersuch = rec.fel === 'versuch'
    const esteEsec = rec.fel === 'esec' || esteVersuch
    // Nu trimitem cât timp o poză sau o semnătură mai e pe drum.
    //
    // Reluarea porneşte în aceeaşi răsuflare cu urcarea (`resume` cheamă
    // `pump()` fără să-l aştepte), deci la revenirea semnalului payloadul se
    // construia din fişierele urcate ATUNCI — adesea niciunul. Iar serverul
    // scrie `photos` peste, fără să întrebe: `coalesce(p_photos, '{}')`. Poza
    // făcută la uşa închisă urca o secundă mai târziu şi rămânea în depozit,
    // nelegată de nimic, pe vecie. Mai bine mai aşteptăm o rundă.
    if (await dovezInZbor(rec.orderId, rec.leg)) {
      // Amânăm — dar numărăm amânările. O poză pe care coada o reîncearcă la
      // nesfârşit (`requeueStuck` îi şterge socoteala la fiecare pornire)
      // arăta mereu „pe drum", deci fişa era sărită de fiecare dată, nu
      // aduna încercări, nu primea niciodată `giveUp` — şi nu apărea în
      // bannerul de dovezi blocate. Oprirea rămânea deschisă pe server,
      // bifată pe telefon, iar turul nu se mai putea încheia, fără ca nimic
      // să spună de ce.
      const asteptari = (rec.asteptari || 0) + 1
      if (asteptari >= MAX_ASTEPTARI) {
        await dbPut(STORE_CONFIRMATIONS, {
          ...rec, asteptari,
          lastError: 'Fotos/Unterschrift konnten nicht hochgeladen werden.',
          giveUp: true,
        })
        console.error('dovezi blocate, confirmarea nu poate pleca:', rec.id)
      } else {
        await dbPut(STORE_CONFIRMATIONS, { ...rec, asteptari })
      }
      pump()
      emit()
      continue
    }
    // Recalculăm payloadul: între timp pot fi urcate fișiere care la
    // momentul confirmării erau încă în coadă.
    const payload = esteVersuch
      ? payloadVersuch(rec, await dbGetByLeg(rec.orderId, rec.leg))
      : esteEsec
      ? payloadEsec(rec.orderId, rec.leg, rec.reason, await dbGetByLeg(rec.orderId, rec.leg))
      : await buildConfirmPayload(rec.orderId, rec.leg, rec.payload.p_signer_name, rec.extra || null)
    const { error } = await supabase.rpc(rec.rpcName, payload)
    if (!error) {
      // Acelaşi `doarPoze` ca la apăsare: un raport „nu s-a putut" nu duce
      // semnătura nicăieri, deci nici n-o ştampilează ca dusă.
      await markConfirmed(rec.orderId, rec.leg, { doarPoze: esteEsec })
      await dbDelete(STORE_CONFIRMATIONS, rec.id)
      // O oprire ratată n-are documente de livrare de sincronizat.
      if (!esteEsec) void syncDeliveryDocuments(rec.orderId, rec.leg)
      emit()
      continue
    }
    // Eşecul se numără şi se scrie. Fără asta, o confirmare refuzată de
    // server se reîncerca la fiecare deschidere a aplicaţiei, la nesfârşit,
    // fără ca nimeni să ştie că există.
    const incercari = (rec.attempts || 0) + 1
    if (!eroareTrecatoare(error) || incercari >= MAX_REPLAY) {
      await dbPut(STORE_CONFIRMATIONS, { ...rec, attempts: incercari, lastError: error.message || String(error), giveUp: true })
      console.error('confirmare respinsă definitiv:', rec.id, error.message)
    } else {
      await dbPut(STORE_CONFIRMATIONS, { ...rec, attempts: incercari, lastError: error.message || String(error) })
    }
    emit()
  }
}

// ---------------------------------------------------------------------------
// Pornire
// ---------------------------------------------------------------------------

let started = false
export function startQueue() {
  // Cerem telefonului să NU şteargă datele când rămâne fără spaţiu.
  // Fără asta, sistemul poate goli baza locală a unei aplicaţii web —
  // adică fix pozele neurcate — ca să facă loc.
  if (navigator.storage?.persist) {
    navigator.storage.persist()
      .then((ok) => { if (!ok) console.warn('stocare permanentă refuzată de sistem') })
      .catch(() => {})
  }
  curataFisePierdute()

  if (started) return
  started = true
  const resume = async () => { await requeueStuck(); pump(); replayPendingConfirmations() }
  window.addEventListener('online', resume)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resume() })
  resume()

  // Verificare periodică cât timp aplicaţia e deschisă.
  //
  // Reluarea depindea de evenimente: „online" (pe semnal slab nu vine
  // niciodată, telefonul n-a fost oficial offline) sau ieşirea şi intrarea
  // înapoi în aplicaţie. Şoferul care stătea cu aplicaţia deschisă aştepta
  // degeaba. Acum la fiecare 10 secunde tot ce aşteaptă primeşte o şansă.
  setInterval(() => {
    if (document.hidden) return
    void (async () => {
      const all = (await dbGetAll(STORE_FILES)) || []
      if (all.some((f) => f.blob && f.status === 'queued')) pump()
    })()
  }, 10000)
}

// Un fișier rămas 'uploading' înseamnă că aplicația a fost închisă în timpul
// încărcării. Îl repunem în coadă — calea fiind stabilă, reluarea suprascrie
// obiectul parțial, nu creează unul nou.
// Fişele rămase fără conţinut.
//
// Poza se scrie în baza locală abia după prelucrare — redimensionare, uneori
// conversie în PDF. Dacă telefonul opreşte aplicaţia exact atunci (memorie
// plină, apel primit, ecran blocat), rămâne o fişă cu status 'processing' şi
// fără octeţi. Nimic nu o mai putea repara: nu are blob, deci nu se poate
// urca, dar se numără la total — iar confirmarea cerea ca TOATE fişierele să
// fie urcate. Şoferul ar fi rămas blocat definitiv, din cauza unei poze care
// nu există.
//
// La fiecare pornire le marcăm ca eşuate, ca să fie vizibile şi refăcute.
async function curataFisePierdute() {
  const all = (await dbGetAll(STORE_FILES)) || []
  const pierdute = all.filter((f) => !f.blob && f.status === 'processing' && Date.now() - (f.createdAt || 0) > 60000)
  if (!pierdute.length) return
  await Promise.all(
    pierdute.map((f) => dbPut(STORE_FILES, { ...f, status: 'lost', error: 'Aufnahme unterbrochen' }))
  )
  console.warn('fişiere fără conţinut, marcate ca pierdute:', pierdute.length)
  emit()
}

async function requeueStuck() {
  const all = (await dbGetAll(STORE_FILES)) || []
  await Promise.all(
    all.filter((f) => (f.status === 'uploading' || f.status === 'failed') && f.blob && !inFlight.has(f.id))
      .map((f) => dbPut(STORE_FILES, { ...f, status: 'queued', progress: 0, error: null, attempts: 0, nextTryAt: null })),
  )
  // Semnalul a revenit sau şoferul s-a întors în aplicaţie: ce aştepta o
  // pauză pleacă acum, nu peste câteva secunde.
  await Promise.all(
    all.filter((f) => f.status === 'queued' && f.nextTryAt)
      .map((f) => patch(f.id, { nextTryAt: null }))
  )
}

// Reîncercarea tuturor fișierelor căzute, dintr-un singur gest.
// Până acum fiecare poză trebuia atinsă separat, iar un fișier ajuns
// 'failed' nu mai pornea singur nici după revenirea semnalului — şoferul
// rămânea cu confirmarea blocată.
export async function retryAllFailed() {
  const all = (await dbGetAll(STORE_FILES)) || []
  const cazute = all.filter((f) => f.status === 'failed' && f.blob)
  if (!cazute.length) return 0
  await Promise.all(
    cazute.map((f) => dbPut(STORE_FILES, { ...f, status: 'queued', progress: 0, error: null, attempts: 0, nextTryAt: null }))
  )
  emit()
  pump()
  return cazute.length
}
