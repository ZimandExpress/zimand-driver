// db.js — stocare persistentă pentru dovezile șoferului.
//
// De ce IndexedDB și nu React state: pozele, documentele și semnătura trebuie
// să supraviețuiască la refresh, la închiderea PWA și la un kill de memorie
// făcut de Android. IndexedDB stochează Blob-uri nativ, fără base64, deci
// fără să dublăm consumul de memorie.
//
// Fără nicio dependință nouă (§43) — API-ul brut e suficient aici.

const DB_NAME = 'zimand-driver'
const DB_VERSION = 1
export const STORE_FILES = 'pod_files'
export const STORE_CONFIRMATIONS = 'pod_confirmations'

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const s = db.createObjectStore(STORE_FILES, { keyPath: 'id' })
        s.createIndex('by_leg', ['orderId', 'leg'], { unique: false })
        s.createIndex('by_status', 'status', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_CONFIRMATIONS)) {
        db.createObjectStore(STORE_CONFIRMATIONS, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const os = t.objectStore(store)
    let result
    try { result = fn(os) } catch (e) { reject(e); return }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

const wrap = (req) => ({ __req: req })

export const dbPut = (store, value) => tx(store, 'readwrite', (os) => wrap(os.put(value)))
export const dbGet = (store, key) => tx(store, 'readonly', (os) => wrap(os.get(key)))
export const dbDelete = (store, key) => tx(store, 'readwrite', (os) => wrap(os.delete(key)))
export const dbGetAll = (store) => tx(store, 'readonly', (os) => wrap(os.getAll()))

export function dbGetByLeg(orderId, leg) {
  return tx(STORE_FILES, 'readonly', (os) => wrap(os.index('by_leg').getAll([orderId, leg])))
}

// ID local stabil — folosit și ca parte din calea de Storage, ca un retry să
// suprascrie exact același obiect în loc să creeze un duplicat (§40).
export function localId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// Curățenie: fișierele deja urcate și confirmate nu mai au rost să ocupe
// spațiu pe telefon. Păstrăm 7 zile ca plasă de siguranță.
export async function pruneOld(maxAgeMs = 7 * 24 * 3600 * 1000) {
  const all = await dbGetAll(STORE_FILES)
  const cutoff = Date.now() - maxAgeMs
  await Promise.all(
    (all || [])
      .filter((f) => f.status === 'confirmed' && f.createdAt < cutoff)
      .map((f) => dbDelete(STORE_FILES, f.id))
  )
}
