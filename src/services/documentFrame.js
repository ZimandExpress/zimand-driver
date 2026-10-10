// documentFrame.js — judecă LIVE, cadru cu cadru, dacă documentul e aşezat
// cum trebuie în dreptunghiul desenat pe ecran. Pe baza verdictului,
// declanşatorul se aprinde sau rămâne stins.
//
// DE CE AICI ŞI NU DUPĂ FOTOGRAFIE
//
// Verificarea de după (imageQuality.js) spune „e mişcată" când şoferul a
// plecat deja de la masă. Iar încadrarea nu se poate repara deloc după: ori e
// tot documentul în poză, ori nu e. Deci ghidul trebuie să decidă ÎNAINTE.
//
// DE CE NU DETECŢIE DE CONTUR
//
// S-a încercat (OpenCV, jscanify) şi s-a renunţat: pe o masă de lemn cu hârtii
// în jur, conturul găsit era al mesei, nu al foii. Un verdict greşit e mai rău
// decât niciunul, fiindcă şoferul învaţă să-l ignore.
//
// Aici nu căutăm documentul în toată imaginea. ŞOFERUL îl aşază în
// dreptunghiul desenat, iar noi verificăm doar lucruri simple ÎN interiorul
// lui şi pe o bandă îngustă în jur. Asta transformă o problemă de viziune
// artificială într-una de numărat pixeli.
//
// CUM ARATĂ O POZĂ BUNĂ DE DOCUMENT — cele şapte condiţii măsurate:
//
//   1. hârtia umple cadrul          — minim 70% din dreptunghi
//   2. nu iese din cadru            — banda din jur: cel mult 25% hârtie,
//                                     altfel lipsesc colţuri sau margini
//   3. telefonul e paralel cu foaia — laturile opuse diferă cu max 10%
//                                     (o foaie fotografiată oblic iese
//                                     trapez: sus lată, jos îngustă)
//   4. foaia e dreaptă, nu strâmbă  — muchia de sus, orizontală ±4%
//   5. text citibil, fără mişcare   — varianţa laplacianului peste prag
//   6. lumină bună                  — nici întuneric, nici ars de flash
//   7. fără pată de reflexie        — cel mult 6% pixeli aproape-albi
//
// Pragurile sunt verificate pe imagini generate (vezi testul din proiect):
// foaie bună, prea mică, ieşită din cadru, oblică, strâmbă, mişcată,
// întunecată şi cu reflexie.

export const PRAGURI = {
  umplere: 0.70,       // cât din dreptunghi trebuie să fie hârtie
  scurgere: 0.25,      // cât poate fi hârtie pe banda din jurul lui
  trapez: 0.10,        // diferenţa între laturile opuse
  strambare: 0.030,    // înclinarea muchiei de sus (cam 4,5 grade)
  claritate: 55,       // varianţa laplacianului (video, nu fotografie)
  luminaMin: 70,
  luminaMax: 238,
  contrast: 42,
  reflexie: 0.05,      // pixeli aproape-albi
  separare: 40,        // distanţa minimă hârtie–fundal, ca să existe o foaie
  detaliuBanda: 60,    // sub atât, banda luminoasă e masa, nu documentul
  hartieMin: 110,      // fără nimic mai luminos de atât, nu e nicio foaie
}

// Ordinea contează: se arată O SINGURĂ îndrumare, cea mai gravă. Patru
// mesaje deodată nu se citesc cu telefonul într-o mână.
// Lumina vine PRIMA: pe întuneric nu se poate şti dacă în cadru e o foaie
// sau tăblia mesei, deci „nicio foaie în cadru" ar trimite şoferul s-o
// caute, când de fapt trebuie doar să aprindă lumina.
const ORDINE = [
  'frameDark', 'frameBright', 'frameNoPaper', 'frameSpill', 'frameTooFar',
  'frameTilt', 'frameSkew', 'frameGlare', 'frameFlat', 'frameBlurry',
  // Ultimul: e un sfat, nu un motiv de blocare.
  'frameLowEdge',
]

// Hârtie deschisă pe masă deschisă: marginile nu se văd, dar documentul e
// probabil bine aşezat. Un „nu încape în cadru" ar fi un verdict GREŞIT, iar
// un verdict greşit învaţă şoferul să ignore toate celelalte. Deci aici doar
// sfătuim şi lăsăm poza să se facă.
const DOAR_SFAT = ['frameLowEdge']

// Prag Otsu: separă hârtia de fundal fără să ştim nimic despre scenă.
// Funcţionează fiindcă histograma are două vârfuri — foaia şi masa.
function otsu(hist, total) {
  let sumTot = 0
  for (let v = 0; v < 256; v++) sumTot += v * hist[v]
  let sumB = 0, wB = 0, maxVar = -1, prag = 128, mediaJos = 0, mediaSus = 255
  for (let v = 0; v < 256; v++) {
    wB += hist[v]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += v * hist[v]
    const mB = sumB / wB
    const mF = (sumTot - sumB) / wF
    const intre = wB * wF * (mB - mF) * (mB - mF)
    if (intre > maxVar) { maxVar = intre; prag = v; mediaJos = mB; mediaSus = mF }
  }
  // Cât de bine se despart cele două grămezi. Pe o masă goală, Otsu taie
  // tot zgomotul în două jumătăţi aproape identice — iar jumătatea de sus
  // ar trece drept „hârtie". Distanţa dintre medii spune că nu e aşa.
  return { prag, separare: mediaSus - mediaJos }
}

/**
 * @param {Uint8ClampedArray} data  pixeli RGBA ai cadrului redus
 * @param {number} w
 * @param {number} h
 * @param {{x:number,y:number,w:number,h:number}} chenar  dreptunghiul ghid,
 *        în pixeli ai aceleiaşi imagini reduse
 * @returns {{ok:boolean, hint:string|null, issues:string[], metrics:object}}
 */
export function analizeazaCadru(data, w, h, chenar) {
  const x0 = Math.max(0, Math.round(chenar.x))
  const y0 = Math.max(0, Math.round(chenar.y))
  const x1 = Math.min(w, Math.round(chenar.x + chenar.w))
  const y1 = Math.min(h, Math.round(chenar.y + chenar.h))
  const cw = x1 - x0
  const ch = y1 - y0
  if (cw < 12 || ch < 12) return { ok: false, hint: 'frameNoPaper', issues: ['frameNoPaper'], metrics: {} }

  // Gri + histogramă, numai în interiorul chenarului.
  const gri = new Float32Array(cw * ch)
  const hist = new Uint32Array(256)
  let suma = 0
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = ((y + y0) * w + (x + x0)) * 4
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      gri[y * cw + x] = g
      hist[g | 0]++
      suma += g
    }
  }
  const total = cw * ch
  const lumina = suma / total

  let acc = 0, p5 = 0, p95 = 255
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.05) { p5 = v; break } }
  acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.95) { p95 = v; break } }
  const contrast = p95 - p5

  // Hârtia: partea luminoasă. Pragul Otsu, ridicat la jumătatea drumului
  // spre vârful luminos — pe o masă deschisă la culoare, Otsu singur taie
  // prea jos şi masa trece drept hârtie.
  const { prag: pragOtsu, separare } = otsu(hist, total)
  const prag = Math.min(250, Math.max(pragOtsu, (pragOtsu + p95) / 2 - 10))
  // Există o foaie în cadru? Două semne, amândouă necesare: ceva luminos
  // (p95) şi o despărţire clară între hârtie şi ce e sub ea.
  const existaHartie = p95 >= PRAGURI.hartieMin && separare >= PRAGURI.separare

  const esteHartie = (v) => v >= prag


  // Reflexie: pete aproape-albe. Flashul pe hârtie lucioasă şterge textul.
  let arse = 0
  for (let p = 0; p < total; p++) if (gri[p] >= 252) arse++
  const reflexie = arse / total

  // Claritate: varianţa laplacianului în interiorul chenarului.
  let lapS = 0, lapSq = 0, n = 0
  for (let y = 1; y < ch - 1; y++) {
    for (let x = 1; x < cw - 1; x++) {
      const i = y * cw + x
      const v = -4 * gri[i] + gri[i - 1] + gri[i + 1] + gri[i - cw] + gri[i + cw]
      lapS += v; lapSq += v * v; n++
    }
  }
  const claritate = n ? (lapSq / n - (lapS / n) * (lapS / n)) : 0

  // Scurgerea în afară: banda din jurul chenarului. Dacă şi acolo e hârtie,
  // documentul e mai mare decât cadrul — lipsesc colţuri.
  const banda = Math.max(4, Math.round(Math.min(cw, ch) * 0.07))
  let bandaTot = 0, bandaHartie = 0
  const inAfara = (x, y) => (x < x0 || x >= x1 || y < y0 || y >= y1)
  for (let y = Math.max(0, y0 - banda); y < Math.min(h, y1 + banda); y++) {
    for (let x = Math.max(0, x0 - banda); x < Math.min(w, x1 + banda); x++) {
      if (!inAfara(x, y)) continue
      const i = (y * w + x) * 4
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      bandaTot++
      if (esteHartie(g)) bandaHartie++
    }
  }
  const scurgere = bandaTot ? bandaHartie / bandaTot : 0

  // Cât detaliu are banda din jur. O foaie care IESE din cadru aduce în
  // bandă text, linii de tabel, muchii — adică detaliu. O masă albă nu
  // aduce nimic. Fără asta, cele două arată identic: bandă luminoasă.
  let bL = 0, bQ = 0, bN = 0
  for (let y = Math.max(1, y0 - banda); y < Math.min(h - 1, y1 + banda); y++) {
    for (let x = Math.max(1, x0 - banda); x < Math.min(w - 1, x1 + banda); x++) {
      if (!inAfara(x, y)) continue
      const q = (yy, xx) => {
        const i = (yy * w + xx) * 4
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      }
      const v = -4 * q(y, x) + q(y, x - 1) + q(y, x + 1) + q(y - 1, x) + q(y + 1, x)
      bL += v; bQ += v * v; bN++
    }
  }
  const detaliuBanda = bN ? (bQ / bN - (bL / bN) * (bL / bN)) : 0

  // Lăţimea hârtiei pe rânduri şi pe coloane, de la primul la ultimul pixel
  // de hârtie. Măsurată aşa, cerneala dinăuntru nu contează: un CMR completat
  // are jumătate din suprafaţă acoperită de tabel şi text, iar o numărătoare
  // de pixeli luminoşi l-ar declara „prea departe" oricât de bine ar fi
  // încadrat. Prima variantă a acestui fişier chiar făcea greşeala asta.
  const latimeRand = (y) => {
    let prim = -1, ultim = -1
    for (let x = 0; x < cw; x++) if (esteHartie(gri[y * cw + x])) { if (prim < 0) prim = x; ultim = x }
    return prim < 0 ? 0 : (ultim - prim + 1)
  }
  const inaltimeColoana = (x) => {
    let prim = -1, ultim = -1
    for (let y = 0; y < ch; y++) if (esteHartie(gri[y * cw + x])) { if (prim < 0) prim = y; ultim = y }
    return prim < 0 ? 0 : (ultim - prim + 1)
  }
  // Întinderea foii: suma lăţimilor pe toate rândurile, raportată la cadru.
  let intindere = 0
  for (let y = 0; y < ch; y++) intindere += latimeRand(y)
  const umplere = existaHartie ? intindere / total : 0

  // Atinge hârtia marginea chenarului? Dacă da, o parte din document e în
  // afara cadrului — oricât de bine ar arăta restul. Verificat direct, nu
  // dedus din lăţimi: o foaie tăiată de cadru dă lăţimi care par „oblice",
  // iar şoferul ar primi îndemnul greşit („ţine telefonul drept") pentru o
  // problemă de încadrare.
  let atingeMarginea = false
  for (let x = 0; x < cw && !atingeMarginea; x++) {
    for (const y of [0, 1, 2, ch - 3, ch - 2, ch - 1]) {
      if (y >= 0 && y < ch && esteHartie(gri[y * cw + x])) { atingeMarginea = true; break }
    }
  }
  for (let y = 0; y < ch && !atingeMarginea; y++) {
    for (const x of [0, 1, 2, cw - 3, cw - 2, cw - 1]) {
      if (x >= 0 && x < cw && esteHartie(gri[y * cw + x])) { atingeMarginea = true; break }
    }
  }

  const medie = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0)
  const randuriSus = [], randuriJos = [], colStanga = [], colDreapta = []
  for (let k = 0; k < 6; k++) {
    randuriSus.push(latimeRand(Math.round(ch * (0.08 + k * 0.03))))
    randuriJos.push(latimeRand(Math.round(ch * (0.92 - k * 0.03))))
    colStanga.push(inaltimeColoana(Math.round(cw * (0.08 + k * 0.03))))
    colDreapta.push(inaltimeColoana(Math.round(cw * (0.92 - k * 0.03))))
  }
  const dif = (a, b) => {
    const m = Math.max(a, b)
    return m > 0 ? Math.abs(a - b) / m : 1
  }
  const trapezV = dif(medie(randuriSus), medie(randuriJos))
  const trapezH = dif(medie(colStanga), medie(colDreapta))

  // Strâmbarea: muchia de sus a hârtiei, în stânga şi în dreapta. Dacă una
  // e mai jos decât cealaltă, foaia e rotită în cadru.
  const susLa = (x) => {
    for (let y = 0; y < ch; y++) if (esteHartie(gri[y * cw + x])) return y
    return -1
  }
  const sS = susLa(Math.round(cw * 0.2))
  const sD = susLa(Math.round(cw * 0.8))
  const strambare = (sS >= 0 && sD >= 0) ? Math.abs(sS - sD) / ch : 0

  const issues = []

  const preaIntuneric = lumina < PRAGURI.luminaMin
  const preaLumina = lumina > PRAGURI.luminaMax
  if (preaIntuneric) issues.push('frameDark')
  else if (preaLumina) issues.push('frameBright')
  else if (contrast < PRAGURI.contrast) issues.push('frameFlat')

  if (!preaIntuneric) {
    if (!existaHartie || umplere < 0.22) {
      // Nicio foaie în cadru: restul măsurătorilor n-ar vorbi despre
      // document, ci despre masă. Nu le punem pe listă, ca să nu trimită
      // şoferul să „îndrepte" o foaie care nu există.
      issues.push('frameNoPaper')
    } else {
      if (scurgere > PRAGURI.scurgere || atingeMarginea) {
        // Banda din jur e şi ea luminoasă, sau hârtia atinge marginea.
        // Două explicaţii, deosebite prin cât detaliu are banda: documentul
        // chiar iese din cadru (aduce text şi muchii, deci detaliu), sau
        // masa e doar deschisă la culoare (bandă netedă).
        issues.push(detaliuBanda >= PRAGURI.detaliuBanda ? 'frameSpill' : 'frameLowEdge')
        // Cât timp foaia e tăiată de cadru, lăţimile nu spun nimic despre
        // unghi: nu mai măsurăm oblicitatea, ca să nu dăm un sfat greşit.
      } else {
        if (umplere < PRAGURI.umplere) issues.push('frameTooFar')
        if (trapezV > PRAGURI.trapez || trapezH > PRAGURI.trapez) issues.push('frameTilt')
        if (strambare > PRAGURI.strambare) issues.push('frameSkew')
      }
      if (reflexie > PRAGURI.reflexie) issues.push('frameGlare')
    }
  }

  if (claritate < PRAGURI.claritate) issues.push('frameBlurry')

  const hint = ORDINE.find((k) => issues.includes(k)) || null
  const blocante = issues.filter((k) => !DOAR_SFAT.includes(k))

  return {
    ok: blocante.length === 0,
    sfat: blocante.length === 0 && issues.length > 0,
    hint,
    issues,
    metrics: {
      umplere: +umplere.toFixed(3),
      separare: Math.round(separare),
      scurgere: +scurgere.toFixed(3),
      detaliuBanda: Math.round(detaliuBanda),
      atingeMarginea,
      trapezV: +trapezV.toFixed(3),
      trapezH: +trapezH.toFixed(3),
      strambare: +strambare.toFixed(3),
      claritate: Math.round(claritate),
      lumina: Math.round(lumina),
      contrast,
      reflexie: +reflexie.toFixed(3),
      prag: Math.round(prag),
    },
  }
}
