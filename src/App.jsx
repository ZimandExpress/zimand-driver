import { useEffect, useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabaseClient'
import { t, getLang, setLang, availableLangs } from './i18n'
import { Truck, CheckCircle2, Wallet, User, LogOut, Menu, Bell, MapPin, FlagTriangleRight, Tag, XCircle, Download, X, Navigation, Trophy, ThumbsUp } from 'lucide-react'
import './index.css'
import PodFiles from './components/PodFiles'
import {
  startQueue, enqueueFiles, enqueueSignature, confirmLeg as queueConfirmLeg,
  isOnline as reteaDisponibila, reportStopFailed,
  subscribe as ascultaCoada, confirmationsStatus, retryStuckConfirmations,
} from './offline/uploadQueue'
import { pruneOld } from './offline/db'
import { analyzeDocumentPhoto } from './services/imageQuality'
// Comprimarea pozelor atașate la raportarea unei probleme.
//
// Funcția era folosită în IncidentSheet fără să fie importată. Eroarea era
// prinsă în tăcere, deci raportul se salva — doar că fără nicio poză, iar
// nici șoferul, nici dispecerul nu aflau.
import { processImage, PHOTO_PRESET } from './services/imageService'

// --- Comenzile, aşa cum le vede o firmă de transport ------------------------
//
// Nu se mai citeşte direct din `orders`. Dreptul firmelor de a citi tabela a
// fost scos odată cu mascarea adreselor, aşa că
// `from('orders').eq('status','open')` întoarce de atunci ZERO rânduri — nu o
// eroare, o listă goală. Pe ecran asta arăta exact ca „nu e nicio licitaţie",
// deşi licitaţiile erau acolo.
//
// Funcţia din bază întoarce aceleaşi rânduri — comenzile la licitaţie, cele pe
// care firma a licitat, cele atribuite şoferilor ei — plus ofertele proprii şi
// şoferul atribuit, cu adresele tăiate până la câştig. Un singur apel, folosit
// de toate ecranele firmei, ca să nu se mai poată desincroniza unul de altul.
//
// La eroare întoarce null, nu listă goală: cine o cheamă păstrează ce avea pe
// ecran. O listă golită de o interogare căzută înseamnă pentru şofer „n-am de
// lucru", iar asta e mai rău decât o listă veche.
async function comenzileFirmei() {
  const { data, error } = await supabase.rpc('courier_orders')
  if (error) { console.error('courier_orders error:', error.message); return null }
  return Array.isArray(data) ? data : []
}

const esteLaLicitatie = (o) => !!o && o.status === 'open' && !o.on_hold


// Jurnal de utilizare Google API — o linie per apel real, "fire-and-forget",
// ca să vedem exact de unde vine consumul (raport în panoul de disponent).
function logApiUsage(apiName, page, description) {
  supabase.from('api_usage_log').insert({ api_name: apiName, source_app: 'driver_app', page, description }).then(() => {}, () => {})
}

function InstallPrompt({ lang }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('zd-install-dismissed') === '1')
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent)

  useEffect(() => {
    function handler(e) {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function dismiss() {
    setDismissed(true)
    localStorage.setItem('zd-install-dismissed', '1')
  }

  async function install() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  if (isStandalone || dismissed) return null
  if (!deferredPrompt && !isIOS) return null

  return (
    <div className="install-banner">
      <Download size={18} strokeWidth={1.8} />
      <span className="install-banner-text">
        {isIOS ? t('installPromptIOS', lang) : t('installPromptAndroid', lang)}
      </span>
      {!isIOS && (
        <button className="install-banner-btn" onClick={install}>{t('installButton', lang)}</button>
      )}
      <button className="install-banner-close" onClick={dismiss}><X size={16} strokeWidth={2} /></button>
    </div>
  )
}

// BUILD-MARKER: 2026-08-26-confirmFormOpen-fix
export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lang, setLangState] = useState(getLang())
  const [needsPassword, setNeedsPassword] = useState(
    () => new URLSearchParams(window.location.search).get('invite') === '1'
  )

  function changeLang(l) {
    setLang(l)
    setLangState(l)
  }

  // Siguranță: dacă o versiune anterioară a blocat derularea paginii
  // (document.body.style.overflow = 'hidden') și nu a mai apucat să o
  // elibereze, o resetăm aici la pornirea aplicației — altfel cineva cu
  // ecranul deja blocat ar rămâne blocat și după actualizare, până șterge
  // manual datele site-ului.
  useEffect(() => {
    document.body.style.overflow = ''
  }, [])

  // Coada de upload pornește o singură dată, la deschiderea aplicației:
  // reia fișierele rămase în așteptare din sesiunea anterioară și retrimite
  // confirmările care nu au apucat să ajungă la server.
  useEffect(() => {
    startQueue()
    pruneOld().catch(() => {})
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }
    supabase
      .from('drivers')
      .select('*')
      .eq('auth_user_id', session.user.id)
      .single()
      .then(async ({ data, error }) => {
        if (data) {
          setProfile(data)
          return
        }
        // Nu există încă un rând în drivers pentru acest cont — dacă emailul
        // se potrivește cu un cont de firmă (courier), îl creăm automat,
        // ca firma să aibă direct acces complet, fără pas manual în plus.
        const { data: courierProfileId } = await supabase.rpc('get_courier_profile_id')
        if (!courierProfileId) {
          setProfile(null)
          return
        }
        const { data: companyName } = await supabase.rpc('get_company_name', { p_profile_id: courierProfileId })
        const { data: created, error: createErr } = await supabase
          .from('drivers')
          .insert({
            name: companyName || session.user.email,
            auth_user_id: session.user.id,
            company_id: courierProfileId,
            // Obligatoriu: valoarea implicită a coloanei este 'employee'.
            // Fără linia asta, o firmă care intra prima dată în aplicație
            // primea un rând de angajat — deci nu vedea prețuri, nu putea
            // licita și nu vedea câștiguri. Contul e al firmei, deci rândul
            // trebuie să fie de firmă.
            account_type: 'owner_operator',
          })
          .select()
          .single()
        if (createErr) {
          console.error('auto-provision driver row error:', createErr.message)
          setProfile(null)
          return
        }
        setProfile(created)
      })
  }, [session])

  function refreshProfile() {
    if (!session) return
    supabase
      .from('drivers')
      .select('*')
      .eq('auth_user_id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data || null))
  }

  function onPasswordSet() {
    setNeedsPassword(false)
    window.history.replaceState({}, '', window.location.pathname)
  }

  if (loading) return <SplashScreen lang={lang} />
  if (!session) return (
    <>
      <InstallPrompt lang={lang} />
      <LoginScreen lang={lang} onChangeLang={changeLang} />
    </>
  )
  if (needsPassword) return <SetPasswordScreen lang={lang} onDone={onPasswordSet} />
  return (
    <>
      <InstallPrompt lang={lang} />
      <DriverShell
        session={session}
        profile={profile}
        onProfileChange={refreshProfile}
        lang={lang}
        onChangeLang={changeLang}
      />
    </>
  )
}

function LangSwitcher({ lang, onChangeLang, dark }) {
  return (
    <div className={`lang-switch ${dark ? 'dark' : ''}`}>
      {availableLangs.map((l) => (
        <button key={l} className={l === lang ? 'active' : ''} onClick={() => onChangeLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

function SplashScreen({ lang }) {
  return (
    <div className="phone-shell center-content">
      <div className="splash-logo">
        <span className="live-dot" /> {t('appName', lang)}
      </div>
    </div>
  )
}

function LoginScreen({ lang, onChangeLang }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('login') // 'login' | 'forgot' | 'sent'

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(t('loginError', lang))
  }

  async function handleForgot(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/?invite=1',
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setMode('sent')
  }

  if (mode === 'forgot' || mode === 'sent') {
    return (
      <div className="phone-shell center-content">
        <LangSwitcher lang={lang} onChangeLang={onChangeLang} />
        <div className="login-card">
          <div className="brand-mark"><span className="live-dot" /> {t('appName', lang)}</div>
          {mode === 'sent' ? (
            <p className="login-sub">{t('resetLinkSent', lang)}</p>
          ) : (
            <>
              <p className="login-sub">{t('forgotPasswordSub', lang)}</p>
              <form onSubmit={handleForgot}>
                <label>{t('email', lang)}</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                {error && <div className="login-error">{error}</div>}
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? '…' : t('sendResetLink', lang)}
                </button>
              </form>
            </>
          )}
          <button className="link-btn" onClick={() => setMode('login')} style={{ marginTop: 14 }}>
            {t('backToLogin', lang)}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="phone-shell center-content">
      <LangSwitcher lang={lang} onChangeLang={onChangeLang} />
      <div className="login-card">
        <div className="brand-mark"><span className="live-dot" /> {t('appName', lang)}</div>
        <p className="login-sub">{t('loginSubtitle', lang)}</p>
        <form onSubmit={handleLogin}>
          <label>{t('email', lang)}</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <label>{t('password', lang)}</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <div className="login-error">{error}</div>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? t('loggingIn', lang) : t('loginButton', lang)}
          </button>
        </form>
        <button className="link-btn" onClick={() => setMode('forgot')} style={{ marginTop: 12 }}>
          {t('forgotPassword', lang)}
        </button>
      </div>
    </div>
  )
}

function SetPasswordScreen({ lang, onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError(t('passwordTooShort', lang))
      return
    }
    if (password !== confirm) {
      setError(t('passwordsDontMatch', lang))
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    onDone()
  }

  return (
    <div className="phone-shell center-content">
      <div className="login-card">
        <div className="brand-mark"><span className="live-dot" /> {t('appName', lang)}</div>
        <p className="login-sub">{t('welcomeSetPassword', lang)}</p>
        <form onSubmit={handleSubmit}>
          <label>{t('newPassword', lang)}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <label>{t('confirmPassword', lang)}</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
          {error && <div className="login-error">{error}</div>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? '…' : t('setPasswordButton', lang)}
          </button>
        </form>
      </div>
    </div>
  )
}

// Ecranul de acceptare a noilor condiţii, în aplicaţia şoferului.
// Acelaşi fond ca în panou: rezumatul schimbărilor, linkul, bifa, butonul.
function AgbGateDriver({ session, setari, lang, onAccepted }) {
  const [bifat, setBifat] = useState(false)
  const [busy, setBusy] = useState(false)
  const [eroare, setEroare] = useState(null)

  const versiune = setari?.agb_partner_version
  const schimbari = (setari?.agb_partner_changes || '').split('\n').filter((x) => x.trim())

  const accepta = async () => {
    setBusy(true); setEroare(null)
    try {
      const { data, error } = await supabase.functions.invoke('accept-agb', { body: {} })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      onAccepted(versiune)
    } catch (e) {
      setEroare(e.message || String(e))
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#F6F4F0', zIndex: 99999, overflowY: 'auto',
                  paddingTop: 'calc(26px + env(safe-area-inset-top, 0px))',
                  paddingBottom: 'calc(26px + env(safe-area-inset-bottom, 0px))' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 18px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-soft)', letterSpacing: '.06em' }}>
          ZIMAND EXPRESS e.K.
        </div>
        <h2 style={{ fontSize: 21, margin: '8px 0 4px', lineHeight: 1.3 }}>Neue AGB für Transportpartner</h2>
        <div style={{ fontSize: 13.5, color: 'var(--text-soft)', marginBottom: 16 }}>
          Fassung {versiune} · Bitte lesen und bestätigen, um fortzufahren.
        </div>

        <div style={{ background: '#fff', borderRadius: 10, padding: '14px 15px', border: '1px solid var(--line, #E2E7EE)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-soft)', letterSpacing: '.04em', marginBottom: 9 }}>
            WAS SICH GEÄNDERT HAT
          </div>
          {schimbari.map((rand, i) => {
            const et = rand.split(' ')[0]
            const culoare = et.startsWith('NEU') ? '#1B6E43' : et.startsWith('GEÄNDERT') ? '#B35A12' : 'var(--text-soft)'
            return (
              <div key={i} style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 8, display: 'flex', gap: 7 }}>
                <span style={{ color: culoare, fontWeight: 800, whiteSpace: 'nowrap' }}>{et}</span>
                <span>{rand.slice(et.length).trim()}</span>
              </div>
            )
          })}
        </div>

        <a href={setari?.agb_partner_url} target="_blank" rel="noreferrer"
           style={{ display: 'inline-block', marginTop: 12, fontWeight: 700, fontSize: 13.5 }}>
          Vollständige AGB lesen →
        </a>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18,
                        background: '#fff', border: '1px solid var(--line, #E2E7EE)', borderRadius: 10,
                        padding: '13px 14px' }}>
          <input type="checkbox" checked={bifat} onChange={(e) => setBifat(e.target.checked)}
                 style={{ marginTop: 2, width: 18, height: 18 }} />
          <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            Ich habe die AGB in der Fassung {versiune} gelesen und akzeptiere sie.
          </span>
        </label>

        {eroare && <div style={{ color: '#B23A24', fontSize: 12.5, marginTop: 9 }}>Fehler: {eroare}</div>}

        <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={accepta} disabled={!bifat || busy}>
          {busy ? 'Wird gespeichert …' : 'AGB akzeptieren und fortfahren'}
        </button>

        <div style={{ fontSize: 11.5, color: 'var(--text-soft)', marginTop: 11, lineHeight: 1.5 }}>
          Sie erhalten anschließend eine E-Mail mit der Bestätigung als PDF und dem Link zur vollständigen Fassung.
        </div>

        <button onClick={() => supabase.auth.signOut()}
                style={{ background: 'none', border: 'none', color: 'var(--text-soft)', fontSize: 13,
                         marginTop: 16, textDecoration: 'underline' }}>
          {t('logout', lang)}
        </button>
      </div>
    </div>
  )
}

function DriverShell({ session, profile, onProfileChange, lang, onChangeLang }) {
  const [tab, setTab] = useState('curse')
  const [menuOpen, setMenuOpen] = useState(false)
  const isOwner = profile?.account_type === 'owner_operator'
  const watchIdRef = useRef(null)

  // Noile condiţii, verificate şi aici.
  //
  // Doar pentru conturile de FIRMĂ: AGB-ul leagă transportatorul, nu şoferul
  // angajat. Un angajat blocat în faţa unui contract pe care nu-l poate
  // semna ar rămâne pur şi simplu fără aplicaţie, la mijlocul unei curse.
  const [agbSetari, setAgbSetari] = useState(null)
  useEffect(() => {
    if (!isOwner) return
    supabase.from('app_settings')
      .select('agb_partner_url, agb_partner_version, agb_partner_changes')
      .limit(1).maybeSingle()
      .then(({ data }) => setAgbSetari(data || null))
  }, [isOwner])

  const [agbAcceptat, setAgbAcceptat] = useState(null)
  useEffect(() => {
    if (!isOwner || !session?.user?.id) return
    supabase.from('profiles')
      .select('agb_version_accepted')
      .eq('id', session.user.id).maybeSingle()
      .then(({ data }) => setAgbAcceptat(data?.agb_version_accepted ?? ''))
  }, [isOwner, session?.user?.id])

  const trebuieAgb =
    isOwner && agbSetari?.agb_partner_version && agbAcceptat !== null
    && agbAcceptat !== agbSetari.agb_partner_version

  // Numărul de oferte încă în așteptare (comandă deschisă, fără câștigător
  // decis încă) — afișat ca cifră lângă "Meine Angebote" în meniu, vizibil
  // indiferent de ecranul curent, nu doar când tab-ul respectiv e deschis.
  const { bids: menuBids } = useCourierBids(isOwner ? session?.user?.id : null)
  const pendingOffersCount = isOwner ? menuBids.filter((b) => b.orders && b.orders.status === 'open').length : 0

  // Send GPS position continuously while profile.is_online is true —
  // starts/stops automatically whenever the toggle in Profile changes it.
  useEffect(() => {
    if (!profile?.is_online || !profile?.id) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      return
    }

    if (!('geolocation' in navigator)) return

    // Scriem în baza de date doar când poziția s-a schimbat semnificativ.
    //
    // Înainte se scria la FIECARE actualizare de poziție, cu precizie maximă —
    // de câteva ori pe minut în mers, adică mii de scrieri pe zi și baterie
    // consumată pentru o precizie de care dispeceratul n-are nevoie.
    //
    // Praguri: 150 de metri sau 60 de secunde de la ultima scriere. În mers,
    // pragul de distanță se atinge oricum la fiecare 10–15 secunde, deci
    // vizibilitatea în Disponent rămâne practic aceeași.
    let lastSent = { lat: null, lng: null, at: 0 }
    const MIN_METERS = 150
    const MIN_MS = 60000

    const sendPosition = (coords) => {
      const now = Date.now()
      if (lastSent.lat != null) {
        const movedMeters = haversineKm(lastSent.lat, lastSent.lng, coords.latitude, coords.longitude) * 1000
        if (movedMeters < MIN_METERS && now - lastSent.at < MIN_MS) return
      }
      lastSent = { lat: coords.latitude, lng: coords.longitude, at: now }
      supabase
        .from('drivers')
        .update({
          last_lat: coords.latitude,
          last_lng: coords.longitude,
          last_location_at: new Date().toISOString(),
        })
        .eq('id', profile.id)
        .then(({ error }) => {
          if (error) console.error('location update error:', error.message)
        })
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => sendPosition(pos.coords),
      (err) => console.error('geolocation error:', err.message),
      // Precizie normală, nu maximă: pentru harta dispeceratului diferența e
      // nesemnificativă, iar consumul de baterie scade considerabil.
      { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [profile?.is_online, profile?.id])

  // Cele două comutatoare din Profil fără de care aplicaţia nu îşi face
  // treaba: dispeceratul nu vede unde e şoferul şi nu îl poate anunţa de
  // curse noi. Mulţi le lasă oprite pur şi simplu fiindcă nu ştiu că există.
  const [stareNotificari, setStareNotificari] = useState('checking')
  useEffect(() => {
    getPushSubscriptionStatus().then(setStareNotificari).catch(() => setStareNotificari('unsupported'))
  }, [tab])

  const lipsesteOnline = !profile?.is_online
  const lipsescNotificarile = stareNotificari === 'unsubscribed'

  // Banda apare DOAR după ce ştim cu adevărat cum stau lucrurile.
  // Înainte, la pornire profilul era încă null şi starea notificărilor
  // „checking" — deci banda clipea o secundă la fiecare deschidere, chiar
  // şi la cei care aveau totul pornit.
  // Un răgaz la pornire. Chiar cu datele încărcate, starea „online" se
  // aşază abia după ce aplicaţia o trimite la server — iar banda clipea
  // exact în fereastra aceea.
  const [ragazTrecut, setRagazTrecut] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setRagazTrecut(true), 3000)
    return () => clearTimeout(id)
  }, [])

  const stareCunoscuta = ragazTrecut && !!profile?.id && stareNotificari !== 'checking'
  const trebuieActivat = stareCunoscuta && tab !== 'profil' && (lipsesteOnline || lipsescNotificarile)

  // Cât timp meniul e deschis, pagina din spate nu are voie să se mişte.
  //
  // Doar `overflow: hidden`. Varianta cu `position: fixed` pe corp bloca
  // derularea, dar pe iPhone schimba înălţimea ecranului — iar panoul
  // meniului rămânea cu o fâşie goală la bază.
  useEffect(() => {
    if (!menuOpen) return
    const vechi = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = vechi }
  }, [menuOpen])

  function navTo(tabId) {
    setTab(tabId)
    setMenuOpen(false)
  }

  // Blocajul stă înaintea întregii aplicaţii: cât timp versiunea acceptată
  // nu e cea curentă, firma nu vede nici curse, nici licitaţii.
  if (trebuieAgb) {
    return (
      <AgbGateDriver
        session={session}
        setari={agbSetari}
        lang={lang}
        onAccepted={(v) => setAgbAcceptat(v)}
      />
    )
  }

  return (
    <div className="phone-shell">
      <div className="brand-strip">
        <span className="brand-strip-name"><span className="live-dot" /> Zimand Express</span>
        <button className="hbtn" aria-label="menu" onClick={() => setMenuOpen(true)}><Menu size={20} strokeWidth={2} /></button>
      </div>

      <div className="screen-body">
        {trebuieActivat && (
          <div style={{
            background: '#FFF6ED', border: '1px solid #FF9D4D', borderRadius: 11,
            padding: '14px 14px 12px', marginBottom: 14,
          }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: '#B35A12', lineHeight: 1.4 }}>
              ⚠ {t('setupBannerTitle', lang)}
            </div>
            <div style={{ fontSize: 13.5, color: '#8A5A16', marginTop: 5, lineHeight: 1.55 }}>
              {lipsesteOnline && lipsescNotificarile
                ? t('setupBannerBoth', lang)
                : lipsesteOnline ? t('setupBannerOnline', lang) : t('setupBannerPush', lang)}
            </div>
            <div style={{ fontSize: 11.5, color: '#A5763E', marginTop: 7, fontStyle: 'italic', lineHeight: 1.5 }}>
              {lipsesteOnline && lipsescNotificarile
                ? t('setupBannerBothEn', lang)
                : lipsesteOnline ? t('setupBannerOnlineEn', lang) : t('setupBannerPushEn', lang)}
            </div>
            <button
              className="btn"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => navTo('profil')}
            >
              {t('setupBannerAction', lang)}
            </button>
          </div>
        )}
        {tab === 'curse' && <RidesScreen profile={profile} isOwner={isOwner} session={session} lang={lang} />}
        {tab === 'angebote' && isOwner && <MeineAngeboteScreen profile={profile} session={session} lang={lang} />}
        {tab === 'abgeschlossen' && <CompletedOrdersListScreen profile={profile} isOwner={isOwner} lang={lang} />}
        {tab === 'nichtangenommen' && isOwner && <NichtAngenommenScreen profile={profile} session={session} lang={lang} />}
        {tab === 'castiguri' && isOwner && <EarningsScreen profile={profile} lang={lang} />}
        {tab === 'fahrzeuge' && <VehiclesScreen session={session} isOwner={isOwner} lang={lang} />}
        {tab === 'profil' && (
          <ProfileScreen
            session={session}
            profile={profile}
            isOwner={isOwner}
            lang={lang}
            onChangeLang={onChangeLang}
            onProfileChange={onProfileChange}
          />
        )}
      </div>

      {createPortal(
        /* Meniul se desenează direct în pagină, nu înăuntrul panoului
           aplicaţiei. Acolo moştenea marginea de jos rezervată barei de
           gesturi a iPhone-ului, iar panoul alb se oprea cu un centimetru
           mai sus decât ecranul. */
      <div className={`menu-overlay ${menuOpen ? 'show' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) setMenuOpen(false) }}>
        <div className="menu-drawer">
          <div className="menu-header">
            <span className="live-dot" /><span className="menu-header-name">Zimand Express</span>
          </div>

          {isOwner && (
            <EarningsMenuCard
              profile={profile}
              open={menuOpen}
              lang={lang}
              onClick={() => navTo('castiguri')}
            />
          )}
          <button className={`menu-item ${tab === 'curse' ? 'active' : ''}`} onClick={() => navTo('curse')}>
            <span className="ic"><Truck size={19} strokeWidth={1.75} /></span>{t('tabRides', lang)}
          </button>
          {isOwner && (
            <button className={`menu-item ${tab === 'angebote' ? 'active' : ''}`} onClick={() => navTo('angebote')}>
              <span className="ic"><Tag size={19} strokeWidth={1.75} /></span>{t('menuOffers', lang)}
              {pendingOffersCount > 0 && <span className="count-pill" style={{ marginLeft: 'auto' }}>{pendingOffersCount}</span>}
            </button>
          )}
          <button className={`menu-item ${tab === 'abgeschlossen' ? 'active' : ''}`} onClick={() => navTo('abgeschlossen')}>
            <span className="ic"><CheckCircle2 size={19} strokeWidth={1.75} /></span>{t('menuCompleted', lang)}
          </button>
          {isOwner && (
            <button className={`menu-item ${tab === 'nichtangenommen' ? 'active' : ''}`} onClick={() => navTo('nichtangenommen')}>
              <span className="ic"><XCircle size={19} strokeWidth={1.75} /></span>{t('menuNotAccepted', lang)}
            </button>
          )}
          {isOwner && (
            <button className={`menu-item ${tab === 'castiguri' ? 'active' : ''}`} onClick={() => navTo('castiguri')}>
              <span className="ic"><Wallet size={19} strokeWidth={1.75} /></span>{t('tabEarnings', lang)}
            </button>
          )}
          <button className={`menu-item ${tab === 'fahrzeuge' ? 'active' : ''}`} onClick={() => navTo('fahrzeuge')}>
            <span className="ic"><Truck size={19} strokeWidth={1.75} /></span>{t('menuVehicles', lang)}
          </button>
          <button className={`menu-item ${tab === 'profil' ? 'active' : ''}`} onClick={() => navTo('profil')}>
            <span className="ic"><User size={19} strokeWidth={1.75} /></span>{t('tabProfile', lang)}
          </button>

          {/* Grupul de jos, lipit de baza panoului. „marginTop: auto" pus
              doar pe linia despărţitoare nu împingea nimic atunci când
              panoul se poate derula — trebuie pe întreg grupul. */}
          <div style={{ marginTop: 'auto' }}>
          <div className="menu-divider" />

          {/* Dispeceratul, la îndemână din orice ecran — nu doar din fişa
              unei curse. Şoferul are întrebări şi între curse. */}
          <a
            className="menu-item"
            href={`https://wa.me/${DISPATCH_WA}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setMenuOpen(false)}
            style={{ color: '#1B9E50', textDecoration: 'none' }}
          >
            <span className="ic"><WhatsAppIcon size={18} /></span>{t('menuDispatch', lang)}
          </a>

          <button className="menu-item logout" onClick={() => supabase.auth.signOut()}>
            <span className="ic"><LogOut size={19} strokeWidth={1.75} /></span>{t('logout', lang)}
          </button>
          </div>
        </div>
      </div>,
        /* În #root, nu în body: pe ecran lat aplicaţia se desenează într-o
           ramă de telefon centrată, iar meniul trebuie să rămână în ea.
           Pe telefon, #root e oricum tot ecranul — şi, spre deosebire de
           .phone-shell, nu are marginea de jos rezervată barei de gesturi,
           care tăia panoul. */
        document.getElementById('root') || document.body
      )}
    </div>
  )
}

// Prețul real, câștigat la licitație, dacă există — nu doar estimarea
// pusă de dispecer la crearea comenzii, care poate fi depășită dacă
// firma a câștigat cu un preț diferit.
function effectivePrice(order) {
  const bidPrice = Array.isArray(order?.winning_bid) ? order.winning_bid[0]?.price : order?.winning_bid?.price;
  return bidPrice != null ? bidPrice : order?.estimated_price;
}

// Cât a produs efectiv o comandă. Identică cu regula din
// partner.zimandexpress.de (MyEarningsPanel):
//
//   - la comandă anulată de client se numără DESPĂGUBIREA, nu prețul;
//   - fără ofertă câștigătoare se numără zero, NU estimarea dispecerului.
//     Estimarea e prețul la care s-a scos comanda la licitație, nu ce
//     încasează firma; dacă o folosim, Driver arată bani care nu apar în
//     decont și nici în Partner.
//
// Diferită, intenționat, de effectivePrice: aceea arată valoarea afișată a
// unei comenzi pe card, inclusiv înainte să existe o ofertă câștigătoare.
// Aici e vorba de bani încasați.
//
// ATENȚIE: aceeași regulă există în panoul de partener. Se schimbă împreună.
function earningsAmount(order) {
  if (!order) return 0
  if (order.client_cancelled) return Number(order.compensation_amount || 0)
  const bid = Array.isArray(order.winning_bid) ? order.winning_bid[0] : order.winning_bid
  return Number(bid?.price || 0)
}

// Data la care o comandă "contează" pentru câștiguri și istoric.
//
// La cursele dus-întors, delivery_confirmed_at e livrarea de la DUS, adică
// jumătatea cursei — nu finalul ei. Dacă o cursă pleacă pe 31 și se întoarce
// pe 1, banii ar apărea în luna greșită. Disponent folosește deja regula de
// mai jos (App.jsx, panoul de disponent), iar aplicația șoferului trebuie să
// spună exact același lucru despre aceeași comandă.
//
// ATENȚIE: aceasta este SINGURA definiție. Dacă se schimbă vreodată, se
// schimbă aici, nu în locurile care o folosesc.
function completionRefDate(order) {
  if (!order) return null
  const confirmed = order.is_round_trip
    ? order.return_delivery_confirmed_at
    : order.delivery_confirmed_at
  return confirmed || order.delivery_date || null
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}.${mm}.${yy}`
}

function fmtTime(timeStr) {
  if (!timeStr) return ''
  return timeStr.slice(0, 5)
}

function fmtDateTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return isoStr
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm}.${yyyy} · ${hh}:${mi}`
}

function statusClass(status) {
  switch (status) {
    case 'open': return 'new'
    case 'assigned': return 'progress'
    case 'done': return 'done'
    case 'cancelled': return 'cancelled'
    default: return 'new'
  }
}

function statusLabel(status, lang) {
  switch (status) {
    case 'open': return t('statusOpen', lang)
    case 'assigned': return t('statusAssigned', lang)
    case 'done': return t('statusDone', lang)
    case 'cancelled': return t('statusCancelled', lang)
    default: return t('statusOpen', lang)
  }
}

// Etapa operațională reală a comenzii, dedusă din timestamp-urile existente.
// NU înlocuiește statusul din baza de date (open/assigned/done/cancelled) —
// îl completează. Backendul rămâne sursa de adevăr; asta e doar o citire mai
// precisă a lui, ca șoferul să vadă unde se află, nu un cuvânt tehnic.
/* ===========================================================================
   TURUL — etapele ca listă, nu ca lanţ de patru
   ===========================================================================

   O cursă obişnuită are două capete: ridicarea şi livrarea, ţinute în
   coloanele `pickup_*` şi `delivery_*` de pe comandă. Dus-întorsul adaugă
   două. Un TUR adaugă oricâte opriri între ele, ca rânduri în `trip_stops`.

   Capetele rămân pe coloanele lor, cu funcţiile lor de pe server, neatinse.
   Opririle din mijloc au funcţiile lor. Aşa, o cursă fără opriri parcurge
   exact acelaşi drum ca înainte — nicio linie nouă.                         */

// Opririle suplimentare, în ordinea de mers. O cursă A→B nu are niciuna.
function tourStops(order) {
  const list = Array.isArray(order?.trip_stops) ? order.trip_stops : []
  return [...list].sort((a, b) => (a.position || 0) - (b.position || 0))
}

// Etapele turului, în ordinea în care se conduc: ridicarea principală, apoi
// ridicările suplimentare, apoi livrările suplimentare, apoi livrarea
// principală, şi la urmă returul dacă e dus-întors.
function tourLegSequence(order) {
  const stops = tourStops(order)
  const seq = [
    { key: 'pickup', kind: 'pickup', stop: null },
    ...stops.filter((s) => s.kind !== 'delivery').map((s) => ({ key: s.id, kind: 'pickup', stop: s })),
    ...stops.filter((s) => s.kind === 'delivery').map((s) => ({ key: s.id, kind: 'delivery', stop: s })),
    { key: 'delivery', kind: 'delivery', stop: null },
  ]
  if (order?.is_round_trip) {
    seq.push({ key: 'return_pickup', kind: 'pickup', stop: null })
    seq.push({ key: 'return_delivery', kind: 'delivery', stop: null })
  }
  return seq
}

const LEG_ADDRESS_FIELD = {
  pickup: 'pickup_address',
  delivery: 'delivery_address',
  return_pickup: 'return_pickup_address',
  return_delivery: 'return_delivery_address',
}

// Faptele unei etape, citite la fel fie că stă pe comandă, fie pe o oprire.
// Tot restul codului vorbeşte prin asta, deci nu mai trebuie să ştie unde
// sunt datele.
function legFacts(order, entry) {
  if (!entry) return null
  if (entry.stop) {
    const s = entry.stop
    return {
      key: s.id, kind: s.kind, stop: s, isStop: true,
      startedAt: s.started_at, arrivedAt: s.arrived_at, confirmedAt: s.confirmed_at,
      failedAt: s.failed_at, failedReason: s.failed_reason,
      address: s.address, company: s.company,
      contactName: s.contact_name, contactPhone: s.contact_phone,
      date: s.stop_date, timeFrom: s.time_from, timeTo: s.time_to,
      // Oră fixă: nu e un interval scurt, e o obligaţie. Scrisă ca interval,
      // şoferul care se uită o clipă pe ecran n-avea cum s-o deosebească.
      timeFixed: !!s.time_fixed, timeAt: s.time_at,
      cargo: s.cargo_desc, weightKg: s.cargo_weight_kg,
      reference: s.reference, note: s.note,
    }
  }
  const k = entry.key
  const esteRetur = k === 'return_pickup' || k === 'return_delivery'
  return {
    key: k, kind: entry.kind, stop: null, isStop: false,
    startedAt: order?.[`${k}_started_at`],
    arrivedAt: order?.[`${k}_arrived_at`],
    confirmedAt: order?.[`${k}_confirmed_at`],
    failedAt: null, failedReason: null,
    address: order?.[LEG_ADDRESS_FIELD[k]],
    company: null, contactName: null, contactPhone: null,
    date: order?.[`${k}_date`], timeFrom: order?.[`${k}_from`], timeTo: order?.[`${k}_to`],
    // Capetele cursei au de mult ora fixă în bază (`pickup_fixed` +
    // `pickup_time`), dar aplicaţia şoferului n-o citea: pe telefon apărea
    // rubrica de interval goală, deşi clientul plătise în plus pentru ea.
    // Returul n-are coloanele astea, deci acolo rămâne fals.
    timeFixed: !esteRetur && !!order?.[`${k}_fixed`],
    timeAt: esteRetur ? null : order?.[`${k}_time`],
    cargo: esteRetur ? order?.return_cargo_desc : order?.cargo_desc,
    weightKg: order?.weight, reference: order?.reference, note: null,
  }
}

// Etapa curentă: prima care n-are nici confirmare, nici motiv de eşec. O
// oprire marcată „nu s-a putut" e încheiată — turul merge înainte peste ea.
function currentLegEntry(order) {
  const seq = tourLegSequence(order)
  for (const e of seq) {
    const f = legFacts(order, e)
    if (!f.confirmedAt && !f.failedAt) return e
  }
  return seq[seq.length - 1]
}

// Numele funcţiilor de pe server, derivate din etapă — nu enumerate. Pentru
// etapele clasice numele coloanelor şi al funcţiilor se potrivesc deja
// (`driver_confirm_pickup`, `pickup_confirmed_at`), aşa că nu e nevoie de
// nicio listă de ramuri.
function legRpcNames(entry) {
  if (entry?.stop) {
    return {
      start: 'driver_mark_stop_started',
      arrive: 'driver_mark_stop_arrived',
      confirm: 'driver_confirm_stop',
      args: { p_stop_id: entry.stop.id },
    }
  }
  return {
    start: `driver_mark_${entry.key}_started`,
    arrive: `driver_mark_${entry.key}_arrived`,
    confirm: `driver_confirm_${entry.key}`,
    args: {},
  }
}

// „Abholung 2 / 3" la un tur; nimic la o cursă obişnuită, ca ea să arate
// exact ca înainte. Returul se numără separat, nu intră în socoteală.
function legCounter(order, entry) {
  if (!entry || entry.key === 'return_pickup' || entry.key === 'return_delivery') return null
  const sameKind = tourLegSequence(order).filter(
    (e) => e.kind === entry.kind && e.key !== 'return_pickup' && e.key !== 'return_delivery',
  )
  if (sameKind.length < 2) return null
  const i = sameKind.findIndex((e) => e.key === entry.key)
  return i < 0 ? null : { n: i + 1, total: sameKind.length }
}

// Cheile de text ale etapelor. Cele clasice sunt EXACT cele de dinainte —
// textul pe care-l vede şoferul la o cursă obişnuită nu se schimbă cu nimic.
const LEG_STAGE_KEYS = {
  pickup:          { ready: 'stageAssigned',         to: 'stageToPickup',         at: 'stageAtPickup' },
  delivery:        { ready: 'stagePickupDone',       to: 'stageToDelivery',       at: 'stageAtDelivery' },
  return_pickup:   { ready: 'stageReturnReady',      to: 'stageReturnToPickup',   at: 'stageReturnAtPickup' },
  return_delivery: { ready: 'stageReturnPickupDone', to: 'stageReturnToDelivery', at: 'stageReturnAtDelivery' },
  _stop:           { ready: 'stageStopReady',        to: 'stageToStop',           at: 'stageAtStop' },
}

function operationalStage(order) {
  if (!order) return { key: 'statusOpen', cls: 'new' }
  if (order.status === 'cancelled') return { key: 'statusCancelled', cls: 'cancelled' }
  if (order.status === 'done') return { key: 'statusDone', cls: 'done' }
  if (order.status !== 'assigned') return { key: 'statusOpen', cls: 'new' }

  for (const e of tourLegSequence(order)) {
    const f = legFacts(order, e)
    if (f.confirmedAt || f.failedAt) continue
    const chei = e.stop ? LEG_STAGE_KEYS._stop : LEG_STAGE_KEYS[e.key]
    if (!f.startedAt) return { key: chei.ready, cls: 'progress', leg: e }
    if (!f.arrivedAt) return { key: chei.to, cls: 'progress', moving: true, leg: e }
    return { key: chei.at, cls: 'progress', leg: e }
  }
  return { key: 'statusDone', cls: 'done' }
}

// Pasul curent din traseu. Dus-întors are șase etape în plus, deci totalul
// diferă — nu afișăm un număr fix care ar minți la cursele de retur.
function stageProgress(order) {
  if (!order || order.status !== 'assigned') return null
  const seq = tourLegSequence(order)
  let done = 0
  for (const e of seq) {
    const f = legFacts(order, e)
    // Oprirea ratată e un pas încheiat: altfel bara ar rămâne în urmă pentru
    // totdeauna, pe o oprire la care nu se mai întoarce nimeni.
    if (f.failedAt) { done += 3; continue }
    if (f.startedAt) done++
    if (f.arrivedAt) done++
    if (f.confirmedAt) done++
  }
  // Trei paşi pe etapă. La o cursă obişnuită iese 6, la dus-întors 12 —
  // adică exact cifrele de dinainte.
  const total = seq.length * 3
  // La un tur, „Schritt 22/63" nu spune nimic: bara înaintează cu 1,6% la
  // fiecare apăsare şi pare înţepenită. Numărăm şi opririle, ca eticheta să
  // poată spune „Stopp 7 / 21".
  const inchise = seq.filter((e) => {
    const f = legFacts(order, e)
    return !!(f.confirmedAt || f.failedAt)
  }).length
  return {
    done, total, current: Math.min(done + 1, total),
    etape: seq.length, inchise, etapaCurenta: Math.min(inchise + 1, seq.length),
  }
}

function StageBadge({ order, lang, style }) {
  const stage = operationalStage(order)
  return (
    <span className={`ride-badge ${stage.cls}`} style={style}>
      {t(stage.key, lang)}
      {stage.moving && <span className="moving-van" style={{ marginLeft: 4 }}>🚚</span>}
    </span>
  )
}

function StageProgress({ order, lang }) {
  const p = stageProgress(order)
  if (!p || p.done === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 2px' }}>
      <div style={{ flex: 1, height: 4, borderRadius: 4, background: '#E7EAF0', overflow: 'hidden' }}>
        <div style={{ width: `${(p.done / p.total) * 100}%`, height: '100%', background: '#FF7A29', transition: 'width .3s' }} />
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#5A6878', whiteSpace: 'nowrap' }}>
        {p.etape > 2
          ? `${t('stopCounterLabel', lang)} ${p.etapaCurenta}/${p.etape}`
          : `${t('stepLabel', lang)} ${p.current}/${p.total}`}
      </span>
    </div>
  )
}

// Contextul audio se creează O SINGURĂ DATĂ, nu la fiecare sunet — pe
// telefoane (mai ales iOS), un AudioContext nou creat fără o atingere
// directă chiar înainte pornește "suspendat" și nu produce niciun sunet,
// fără nicio eroare vizibilă. Îl deblocăm o dată, la prima atingere din
// aplicație, și îl refolosim mereu după aceea.
let sharedAudioCtx = null
function getSharedAudioCtx() {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return sharedAudioCtx
}
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      const ctx = getSharedAudioCtx()
      if (ctx.state === 'suspended') ctx.resume()
    } catch {}
    window.removeEventListener('pointerdown', unlockAudio)
    window.removeEventListener('touchstart', unlockAudio)
  }
  window.addEventListener('pointerdown', unlockAudio, { once: true })
  window.addEventListener('touchstart', unlockAudio, { once: true })
}

// Sunetele aplicației.
//
// Fiecare fișier se descarcă o singură dată și se decodează în contextul audio
// deja deblocat de prima atingere din aplicație. Redarea printr-un element
// <audio> obișnuit ar fi blocată de regulile de pornire automată ale
// browserului pe telefon; prin contextul partajat merge, fiindcă el a fost
// deblocat de o atingere reală.
//
// Dacă un fișier lipsește sau decodarea eșuează, se aud tonurile generate din
// cod. Un șofer fără sunet e mai rău decât un sunet mai puțin frumos.
const SOUND_FILES = {
  // Ceva a intrat și merită privit: comandă nouă în licitație sau comandă
  // atribuită. Se aude la toate tipurile de cont — firmă sau angajat.
  incoming: '/sounds/neuer-auftrag.mp3',
  // Ceva s-a câștigat sau s-a confirmat. Mai rar, deci poate fi mai apăsat.
  success: '/sounds/auftrag-bestaetigt.mp3',
}

const soundBuffers = {}
const soundLoads = {}

function loadSound(name) {
  if (soundBuffers[name]) return Promise.resolve(soundBuffers[name])
  if (soundLoads[name]) return soundLoads[name]
  const url = SOUND_FILES[name]
  if (!url) return Promise.resolve(null)

  soundLoads[name] = fetch(url)
    .then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.arrayBuffer() })
    .then((buf) => getSharedAudioCtx().decodeAudioData(buf))
    .then((decoded) => { soundBuffers[name] = decoded; return decoded })
    .catch((err) => { console.error('sound load failed:', err.message); return null })
  return soundLoads[name]
}

// Le pregătim din timp, ca prima notificare să nu aștepte descărcarea.
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => {
    Object.keys(SOUND_FILES).forEach(loadSound)
  }, { once: true })
}

function playSound(name, volume) {
  loadSound(name).then((buffer) => {
    if (!buffer) { playBusinessChime(); return }
    try {
      const ctx = getSharedAudioCtx()
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      const src = ctx.createBufferSource()
      const gain = ctx.createGain()
      gain.gain.value = volume ?? 0.9
      src.buffer = buffer
      src.connect(gain)
      gain.connect(ctx.destination)
      src.start()
    } catch (err) {
      console.error('sound playback failed:', err.message)
      playBusinessChime()
    }
  })
}

const playNewOrderSound = () => playSound('incoming')
const playSuccessSound = () => playSound('success')

function playBusinessChime() {
  try {
    const ctx = getSharedAudioCtx()
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}) }
    const now = ctx.currentTime

    // Sunetul de notificare.
    //
    // Construit din trei note ascendente pe acordul de La major — La, Do#,
    // Mi — cu a treia ținută mai mult. Urcarea se citește ca „ceva a sosit",
    // nu ca „ceva s-a stricat"; un interval descendent ar suna a eroare.
    //
    // Fiecare notă are un armonic slab peste ea, la dublul frecvenței. Fără
    // el, tonurile sinusoidale pure sună a ceas deșteptător ieftin; cu el,
    // capătă corp și se aud mai bine în cabină, unde zgomotul de motor
    // acoperă tocmai frecvențele joase.
    //
    // Atacul e de 15 ms, nu instantaneu: o pornire bruscă produce un pocnet
    // audibil pe difuzoarele de telefon.
    const note = (freq, start, dur, gain) => {
      const osc = ctx.createOscillator()
      const harm = ctx.createOscillator()
      const g = ctx.createGain()
      const hg = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.value = freq
      harm.type = 'sine'
      harm.frequency.value = freq * 2

      g.gain.setValueAtTime(0, now + start)
      g.gain.linearRampToValueAtTime(gain, now + start + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)

      hg.gain.setValueAtTime(0, now + start)
      hg.gain.linearRampToValueAtTime(gain * 0.22, now + start + 0.015)
      hg.gain.exponentialRampToValueAtTime(0.0001, now + start + dur * 0.7)

      osc.connect(g); g.connect(ctx.destination)
      harm.connect(hg); hg.connect(ctx.destination)
      osc.start(now + start); osc.stop(now + start + dur + 0.05)
      harm.start(now + start); harm.stop(now + start + dur + 0.05)
    }

    note(880.00, 0.00, 0.20, 0.16)   // La
    note(1108.73, 0.09, 0.22, 0.15)  // Do#
    note(1318.51, 0.18, 0.75, 0.17)  // Mi, ținut
  } catch (err) {
    console.error('sound error:', err.message)
  }
}

// Notificări push — funcționează chiar cu telefonul blocat sau aplicația
// complet închisă (spre deosebire de playBusinessChime, care sună doar
// cât timp aplicația e deschisă pe ecran). Cheia publică e sigură de expus
// direct în cod — doar cheia PRIVATĂ (păstrată exclusiv pe server) permite
// trimiterea efectivă de notificări.
const VAPID_PUBLIC_KEY = 'BLthWKCmDxZ6A-TcmZgJoHh2BygVynBWng6u_9-NhSV1U52y2qlaCKvvy5rQD5cScBKUVsFb9NNeIGxLr8F5f84'

// Cheia de dinainte: BEpxgH8YgPfWzEXVtiseNj-kw0TgE3fcj3MPOA2OncaqtAooQnWcMFJsfos9JWVrNd9lRZUkW88UC7XLbwU_RJ4
//
// Ea a rămas în cod, dar cheia PRIVATĂ care i-ar fi corespuns nu a ajuns
// niciodată în secretele serverului. Rezultatul: telefoanele se abonau, dar
// nicio notificare nu putea fi trimisă — și nimeni n-avea cum să observe,
// fiindcă abonarea reușea.
//
// Cele trei abonamente făcute cu ea sunt inutilizabile. Codul de mai jos le
// detectează și le reface automat.

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

async function getPushSubscriptionStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return 'unsubscribed'
  // Un abonament cu cheie veche e ca și inexistent: arată-l ca neabonat, ca
  // șoferul să apese din nou și să se refacă.
  return subscriptionUsesCurrentKey(sub) ? 'subscribed' : 'unsubscribed'
}

// Compară cheia cu care a fost făcut un abonament existent cu cea curentă.
// Telefonul păstrează abonamentul chiar dacă cheia serverului s-a schimbat —
// iar atunci notificările nu mai ajung niciodată, fără niciun semn.
function subscriptionUsesCurrentKey(sub) {
  try {
    const key = sub?.options?.applicationServerKey
    if (!key) return true // nu putem verifica: nu forțăm o reabonare inutilă
    const bytes = new Uint8Array(key)
    const current = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    if (bytes.length !== current.length) return false
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== current[i]) return false
    return true
  } catch { return true }
}

async function subscribePush(driverId) {
  const reg = await navigator.serviceWorker.ready
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Berechtigung für Benachrichtigungen wurde nicht erteilt.')

  // Un abonament vechi, făcut cu altă cheie, trebuie desființat întâi —
  // altfel browserul refuză abonarea cu cheia nouă.
  const existing = await reg.pushManager.getSubscription()
  if (existing && !subscriptionUsesCurrentKey(existing)) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', existing.endpoint)
    await existing.unsubscribe()
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  const raw = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { driver_id: driverId, endpoint: raw.endpoint, p256dh: raw.keys.p256dh, auth: raw.keys.auth },
    { onConflict: 'endpoint' }
  )
  if (error) throw error
}

async function unsubscribePush(driverId) {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
}

function VehiclesScreen({ session, isOwner, lang }) {
  const companyProfileId = useCompanyProfileId(session, null)
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ model: '', plate: '', year: '' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    if (!companyProfileId) return
    supabase
      .from('vehicles')
      .select('*')
      .eq('company_id', companyProfileId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { setVehicles(data || []); setLoading(false) })
  }
  useEffect(load, [companyProfileId]) // eslint-disable-line react-hooks/exhaustive-deps

  const addVehicle = async () => {
    if (!form.model.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase.from('vehicles').insert({
        company_id: companyProfileId, model: form.model.trim(), plate: form.plate.trim() || null,
        year: form.year ? Number(form.year) : null,
        fuel_type: 'Diesel', euro_norm: 'Euro 6', tachograph: 'Digital',
      })
      if (error) throw error
      setForm({ model: '', plate: '', year: '' })
      load()
    } catch (e) { alert(e.message) }
    setSaving(false)
  }

  const removeVehicle = async (id) => {
    await supabase.from('vehicles').delete().eq('id', id)
    setVehicles((vs) => vs.filter((v) => v.id !== id))
  }

  if (loading) return <PlaceholderScreen title={t('menuVehicles', lang)} note={t('loadingRides', lang)} />

  return (
    <div className="rides-list">
      <h2 className="screen-title">{t('menuVehicles', lang)}</h2>
      {vehicles.length === 0 ? (
        <div className="empty-note">{t('noVehicles', lang)}</div>
      ) : (
        vehicles.map((v) => (
          <div key={v.id} className="ride-card2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{v.model}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-soft)' }}>{v.plate || '—'}{v.year ? ` · ${v.year}` : ''}</div>
            </div>
            <button onClick={() => removeVehicle(v.id)} style={{ background: 'none', border: 'none', color: '#B23A24', fontSize: 13, cursor: 'pointer' }}>✕</button>
          </div>
        ))
      )}

      <div className="ride-card2" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{t('addVehicleTitle', lang)}</div>
        <input className="doc-type-select" style={{ width: '100%', marginBottom: 8 }} placeholder={t('vehicleModelPlaceholder', lang)} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input className="doc-type-select" style={{ flex: 1 }} placeholder={t('vehiclePlatePlaceholder', lang)} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
          <input className="doc-type-select" style={{ width: 90 }} type="number" placeholder={t('vehicleYearPlaceholder', lang)} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
        </div>
        <button className="btn" onClick={addVehicle} disabled={saving || !form.model.trim()}>{saving ? '…' : t('addVehicleButton', lang)}</button>
      </div>
    </div>
  )
}

function RidesScreen({ profile, isOwner, session, lang }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedIdState] = useState(() => sessionStorage.getItem('zd-open-order') || null)
  const [activeTab, setActiveTab] = useState('mine')
  const [sortAsc, setSortAsc] = useState(true)
  const [openCount, setOpenCount] = useState(0)
  const [newOrderToast, setNewOrderToast] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [directAwardToast, setDirectAwardToast] = useState(null)
  const [celebration, setCelebration] = useState(null) // number (net earnings) | true (no amount) | null — la nivel de ecran, supraviețuiește comutării spre CompletedOrderDetail
  const [notifyRadiusKm, setNotifyRadiusKm] = useState(null)
  const openCountLoaded = useRef(false)
  // Id-urile licitaţiilor deja văzute — de aici ştim care e nouă.
  const licitatiiVazute = useRef(null)
  // Oglindă a listei de comenzi, citibilă din handler-ul Realtime fără să-l
  // legăm de starea curentă (altfel abonamentul s-ar reface la fiecare
  // schimbare de comandă).
  const ordersRef = useRef([])
  // La un cont de firmă, toate rândurile de șofer ale firmei. La un angajat
  // cu cont propriu, doar al lui.
  const driverIds = useOwnDriverIds(session, profile)
  const driverLocationForNotify = useDriverLocation(session)
  const mapsKeyForNotify = useGoogleMapsKey()

  useEffect(() => {
    if (!isOwner || !profile?.id) return
    // profile.id este id-ul rândului din tabela `drivers`, NU al profilului de
    // firmă. Raza se citea după id greșit, interogarea nu întorcea niciodată
    // nimic, iar filtrul pe distanță nu funcționa deloc: șoferul primea sunet
    // pentru orice comandă nouă, oricât de departe. La ecranul de licitații
    // aceeași valoare se citea corect, după session.user.id.
    supabase.from('profiles').select('preferred_radius_km').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => { if (data?.preferred_radius_km) setNotifyRadiusKm(data.preferred_radius_km) })
  }, [isOwner, session?.user?.id])

  useEffect(() => {
    if (!isOwner) return

    // Anunţul unei licitaţii noi: sunet şi mesaj, dacă e în raza aleasă.
    // Scos din mâna realtime-ului şi pus deoparte, fiindcă îl cheamă acum şi
    // verificarea periodică.
    async function anuntaComandaNoua(comanda) {
      if (!comanda || comanda.on_hold) return
      // Dacă șoferul are o rază preferată setată, notificăm doar pentru
      // comenzi din acel raion — cele mai îndepărtate rămân vizibile
      // în listă, dar fără sunet/notificare.
      let withinRadius = true
      if (notifyRadiusKm != null && driverLocationForNotify && mapsKeyForNotify && comanda.pickup_address) {
        const point = await geocodeAddressCached(comanda.pickup_address, mapsKeyForNotify)
        if (point) {
          const km = haversineKm(driverLocationForNotify.lat, driverLocationForNotify.lng, point.lat, point.lng)
          withinRadius = km <= notifyRadiusKm
        }
      }
      if (withinRadius) {
        playNewOrderSound()
        setNewOrderToast(true)
        setTimeout(() => setNewOrderToast(false), 4000)
      }
    }

    function refreshOpenCount() {
      Promise.all([
        comenzileFirmei(),
        supabase.from('bids').select('order_id').eq('courier_id', session?.user?.id),
      ]).then(([comenzi, bidsRes]) => {
        // null = interogarea a căzut. Nu stingem numărul de pe ecran.
        if (!comenzi) return
        const biddedIds = new Set((bidsRes.data || []).map((b) => b.order_id))
        const deschise = comenzi.filter(esteLaLicitatie)
        setOpenCount(deschise.filter((o) => !biddedIds.has(o.id)).length)

        // Care sunt noi faţă de data trecută. La prima încărcare nu sună
        // nimic — altfel ar ţiui la fiecare deschidere a aplicaţiei.
        const acum = new Set(deschise.map((o) => o.id))
        const inainte = licitatiiVazute.current
        if (inainte) {
          deschise.filter((o) => !inainte.has(o.id) && !biddedIds.has(o.id)).forEach(anuntaComandaNoua)
        }
        licitatiiVazute.current = acum
      })
    }

    refreshOpenCount()
    openCountLoaded.current = true

    // Realtime pe `orders` nu mai ajunge la firme: abonamentul trece tot prin
    // drepturile de citire, iar acelea nu mai există. Rămâne pe loc pentru
    // cine are dreptul, dar nu ne mai bazăm pe el — licitaţiile noi se văd
    // dintr-o verificare la fiecare 25 de secunde.
    const ceas = setInterval(refreshOpenCount, 25000)
    const laTrezire = () => refreshOpenCount()
    window.addEventListener('focus', laTrezire)

    const channel = supabase
      .channel('rides-open-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'status=eq.open' }, async (payload) => {
        refreshOpenCount()
        if (payload.eventType === 'INSERT' && openCountLoaded.current && !payload.new?.on_hold) {
          await anuntaComandaNoua(payload.new)
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids', filter: `courier_id=eq.${session?.user?.id}` }, refreshOpenCount)
      .subscribe()

    return () => {
      clearInterval(ceas)
      window.removeEventListener('focus', laTrezire)
      supabase.removeChannel(channel)
    }
  }, [isOwner, notifyRadiusKm, driverLocationForNotify, mapsKeyForNotify, session?.user?.id])

  useEffect(() => { ordersRef.current = orders }, [orders])

  function setSelectedId(id) {
    setSelectedIdState(id)
    if (id) {
      sessionStorage.setItem('zd-open-order', id)
    } else {
      sessionStorage.removeItem('zd-open-order')
    }
  }

  useEffect(() => {
    if (!profile?.id || !driverIds) {
      if (!profile?.id) setLoading(false)
      return
    }

    let active = true

    const loadOrders = () =>
      supabase
        .from('orders')
        .select('*, winning_bid:bids!fk_winner_bid(price), trip_stops(*)')
        .in('assigned_driver_id', driverIds)
        .then(({ data, error }) => {
          if (error) console.error('orders fetch error:', error.message)
          if (active) {
            // O interogare căzută nu goleşte lista.
            //
            // PostgREST respinge toată cererea dacă o îmbinare e refuzată
            // (`trip_stops(*)`), iar lista golită arăta „nicio cursă" — mai
            // rău decât un tur fără opriri, fiindcă şoferul credea că n-are
            // nimic de lucru. Păstrăm ce aveam şi spunem că n-a reuşit.
            if (error) setFetchError(error.message || 'fetch')
            else { setOrders(data || []); setFetchError(null) }
            setLoading(false)
          }
        })

    loadOrders()

    // Recitim comenzile când aplicația revine în prim-plan sau când revine
    // internetul.
    //
    // Pe telefon, conexiunea în timp real se închide cât timp aplicația stă
    // în fundal. Modificările făcute de dispecer în acel interval nu ajung
    // niciodată, iar la redeschidere ecranul arată datele de dinainte — fără
    // ca nimic să pară în neregulă.
    const onWake = () => { if (document.visibilityState === 'visible') loadOrders() }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('online', onWake)

    // Reîncarcă o singură comandă, cu prețul câștigat alăturat.
    const refetchOne = (id) => {
      supabase
        .from('orders')
        .select('*, winning_bid:bids!fk_winner_bid(price), trip_stops(*)')
        .eq('id', id)
        .maybeSingle()
        .then(({ data }) => {
          if (!active || !data) return
          setOrders((current) => current.map((o) => (o.id === data.id ? data : o)))
        })
    }

    // Realtime filtrează doar pe egalitate, deci un abonament per șofer.
    // La o firmă cu doi-trei angajați sunt două-trei abonamente, nu mai mult.
    let channel = supabase.channel('driver-orders-' + profile.id)
    driverIds.forEach((driverId) => {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `assigned_driver_id=eq.${driverId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setOrders((current) => current.filter((o) => o.id !== payload.old.id))
            return
          }

          const known = ordersRef.current.find((o) => o.id === payload.new.id)

          // O comandă care apare atribuită în listă înseamnă același lucru
          // din punctul de vedere al șoferului: e a lui.
          //
          // Fie firma a câștigat licitația, fie dispecerul i-a dat-o direct,
          // fie o firmă colaboratoare i-a trimis-o. În toate cazurile sună
          // confirmarea, nu semnalul de comandă nouă — acela e pentru ce
          // apare în licitație și încă trebuie câștigat.
          //
          // Până acum nu se auzea nimic la atribuire: sunetul se declanșa doar
          // la comenzi noi în licitație, iar push-ul se trimitea doar firmelor
          // eligibile. O comandă atribuită ajungea tăcut în listă.
          if (!known && payload.new.status === 'assigned') {
            playSuccessSound()
            setDirectAwardToast(payload.new.order_number || payload.new.id.slice(0, 8))
            setTimeout(() => setDirectAwardToast(null), 8000)
          }

          // Realtime trimite rândul BRUT din `orders`. Prețul câștigat la
          // licitație stă în `bids` și vine doar prin join, la încărcarea
          // inițială — nu e în acest payload. Dacă înlocuim obiectul întreg,
          // cum se făcea înainte, câmpul dispare, iar interfața cade pe
          // estimated_price, adică prețul cu care dispecerul a postat comanda.
          // Concret: la prima apăsare de „Losfahren" se pierdea prețul real,
          // iar la finalizare ecranul de felicitare arăta suma greșită.
          // De aceea fuzionăm și păstrăm câmpul, în loc să înlocuim.
          setOrders((current) => {
            if (!known) return [...current, payload.new]
            return current.map((o) => (o.id === payload.new.id ? { ...o, ...payload.new } : o))
          })

          // Reîncărcăm doar când chiar e nevoie: comandă nouă în listă, sau
          // câștigătorul s-a schimbat (atunci prețul păstrat nu mai e valabil).
          if (!known || known.winner_bid_id !== payload.new.winner_bid_id || !known.winning_bid) {
            refetchOne(payload.new.id)
          }
        },
      )
    })
    // Opririle unui tur stau în `trip_stops`, nu pe comandă — deci o
    // modificare a lor NU trezeşte abonamentul de mai sus. Fără asta, un
    // şofer care ţine aplicaţia deschisă conduce la adresa veche după ce
    // dispeceratul a schimbat-o, şi nu află niciodată.
    //
    // Fără filtru: politicile din bază limitează deja rândurile la cursele
    // lui, iar un filtru per comandă ar cere un abonament per cursă.
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_stops' },
      (payload) => {
        const orderId = payload.new?.order_id || payload.old?.order_id
        if (orderId && ordersRef.current.some((o) => o.id === orderId)) refetchOne(orderId)
      },
    )

    channel.subscribe()

    return () => {
      active = false
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('online', onWake)
      supabase.removeChannel(channel)
    }
  }, [profile?.id, driverIds])

  const [stareCoada, setStareCoada] = useState({ asteapta: 0, blocate: 0, primaEroare: null })
  useEffect(() => {
    let viu = true
    const citeste = () => confirmationsStatus().then((x) => { if (viu) setStareCoada(x) }).catch(() => {})
    citeste()
    const stop = ascultaCoada(citeste)
    return () => { viu = false; if (typeof stop === 'function') stop() }
  }, [])

  const bannerDovezi = (stareCoada.asteapta > 0 || stareCoada.blocate > 0) ? (
    <div style={{
      background: stareCoada.blocate > 0 ? '#FDECEA' : '#FFF7E8',
      border: `1.5px solid ${stareCoada.blocate > 0 ? '#D98375' : '#D99A1F'}`,
      borderRadius: 10, padding: '12px 14px', margin: '0 0 12px',
      fontSize: 13.5, color: stareCoada.blocate > 0 ? '#8A2A17' : '#6B5430', lineHeight: 1.5,
    }}>
      <div style={{ fontWeight: 700 }}>
        {stareCoada.blocate > 0
          ? `⚠ ${t('proofStuckTitle', lang)}`
          : `⏳ ${t('proofPendingTitle', lang)}`}
      </div>
      <div>
        {stareCoada.blocate > 0
          ? t('proofStuckBody', lang)
          : t('proofPendingBody', lang)}
      </div>
      {stareCoada.blocate > 0 && (
        <button type="button" className="btn secondary" style={{ marginTop: 10 }}
                onClick={() => retryStuckConfirmations()}>
          {t('proofStuckRetry', lang)}
        </button>
      )}
    </div>
  ) : null

  const bannerEroare = fetchError ? (
    <div style={{
      background: '#FFF7E8', border: '1.5px solid #D99A1F', borderRadius: 10,
      padding: '12px 14px', margin: '0 0 12px', fontSize: 13.5, color: '#6B5430', lineHeight: 1.5,
    }}>
      ⚠ {t('ridesFetchFailed', lang)}
    </div>
  ) : null

  if (loading) return <PlaceholderScreen title={t('tabRides', lang)} note={t('loadingRides', lang)} />

  const selected = orders.find((o) => o.id === selectedId)
  if (selected && (selected.status === 'done' || selected.status === 'cancelled')) {
    return <CompletedOrderDetail order={selected} isOwner={isOwner} lang={lang} onBack={() => setSelectedId(null)} />
  }
  if (selected) {
    return <RideDetailScreen order={selected} isOwner={isOwner} session={session} profile={profile} lang={lang} onBack={() => setSelectedId(null)} onStatusChange={() => {}} onDeliveryComplete={(amount) => {
      // Ecranul de felicitare cu suma câștigată este pentru firmele partenere,
      // care văd remunerația. Un angajat la a unsprezecea livrare din tură nu
      // are ce sărbători — se întoarce direct în lista de comenzi.
      setSelectedId(null)
      if (amount != null) setCelebration(amount)
    }} />
  }

  const activeOrders = orders.filter((o) => o.status === 'assigned')

  function sortByDate(list, dateKey) {
    return [...list].sort((a, b) => {
      const da = a[dateKey] || ''
      const db = b[dateKey] || ''
      return sortAsc ? da.localeCompare(db) : db.localeCompare(da)
    })
  }

  const sortedActive = sortByDate(activeOrders, 'pickup_date')

  const tabs = isOwner ? ['available', 'mine'] : ['mine']
  const currentTab = tabs.includes(activeTab) ? activeTab : 'mine'

  return (
    <>
      <div className="rides-list">
        {newOrderToast && (
          <div className="new-order-toast">
            <Bell size={16} strokeWidth={2} /> {t('newOrderAlert', lang)}
          </div>
        )}
        {directAwardToast && (
          <div className="new-order-toast" style={{ background: '#1F7A50' }}>
            <Bell size={16} strokeWidth={2} /> {t('directAwardAlert', lang)} · {directAwardToast}
          </div>
        )}
        <div className="rides-tabs">
          {tabs.map((tabKey) => (
            <button
              key={tabKey}
              className={`rides-tab ${currentTab === tabKey ? 'active' : ''}`}
              onClick={() => setActiveTab(tabKey)}
            >
              {tabKey === 'available' && t('tabAvailable', lang)}
              {tabKey === 'available' && <span className="rides-tab-count">{openCount}</span>}
              {tabKey === 'mine' && t('tabMine', lang)}
              {tabKey === 'mine' && <span className="rides-tab-count">{activeOrders.length}</span>}
            </button>
          ))}
        </div>

        {currentTab === 'available' && <BiddingScreen profile={profile} session={session} lang={lang} embedded />}

        {currentTab === 'mine' && (
          <>
            {bannerDovezi}
            {bannerEroare}
            <div className="rides-toolbar">
              <button className="filter-btn" disabled title={t('comingSoon', lang)}>
                ⏷ {t('filter', lang)}
              </button>
              <button className="sort-btn" onClick={() => setSortAsc((v) => !v)}>
                {t('sortLabel', lang)}: {sortAsc ? t('sortOldest', lang) : t('sortNewest', lang)}
              </button>
            </div>
            {sortedActive.length === 0 ? (
              <div className="empty-note">{t('noActiveRides', lang)}</div>
            ) : (
              sortedActive.map((o) => (
                <RideCard key={o.id} order={o} isOwner={isOwner} lang={lang} onClick={() => setSelectedId(o.id)} />
              ))
            )}
          </>
        )}
      </div>
      {celebration !== null && <CelebrationScreen amount={typeof celebration === 'number' ? celebration : null} lang={lang} onClose={() => setCelebration(null)} />}
    </>
  )
}

function CompletedOrdersListScreen({ profile, isOwner, lang }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedIdState] = useState(() => sessionStorage.getItem('zd-open-completed') || null)

  function setSelectedId(id) {
    setSelectedIdState(id)
    if (id) {
      sessionStorage.setItem('zd-open-completed', id)
    } else {
      sessionStorage.removeItem('zd-open-completed')
    }
  }

  useEffect(() => {
    if (!profile?.id) { setLoading(false); return }
    supabase
      .from('orders')
      .select('*, winning_bid:bids!fk_winner_bid(price), trip_stops(*)')
      .eq('assigned_driver_id', profile.id)
      .in('status', ['done', 'cancelled'])
      .then(({ data, error }) => {
        // O interogare căzută nu goleşte istoricul: fără date noi păstrăm ce e
        // deja pe ecran, ca şoferul să nu creadă că i-au dispărut cursele.
        if (error) console.error('completed orders fetch error:', error.message)
        else setOrders(data || [])
        setLoading(false)
      })
  }, [profile?.id])

  if (loading) return <PlaceholderScreen title={t('menuCompleted', lang)} note={t('loadingRides', lang)} />

  const selected = orders.find((o) => o.id === selectedId)
  if (selected) {
    return <CompletedOrderDetail order={selected} isOwner={isOwner} lang={lang} onBack={() => setSelectedId(null)} />
  }

  const sorted = [...orders].sort((a, b) => {
    const da = completionRefDate(a) || ''
    const db = completionRefDate(b) || ''
    return db.localeCompare(da)
  })

  return (
    <div className="rides-list">
      <h2 className="screen-title">{t('menuCompleted', lang)}</h2>
      {sorted.length === 0 ? (
        <div className="empty-note">{t('noRides', lang)}</div>
      ) : (
        sorted.map((o) => (
          <RideCard key={o.id} order={o} isOwner={isOwner} lang={lang} onClick={() => setSelectedId(o.id)} compact />
        ))
      )}
    </div>
  )
}

function RideCard({ order, isOwner, lang, onClick, compact }) {
  if (compact) {
    const isCancelled = order.status === 'cancelled'
    return (
      <div className="ride-row-compact" onClick={onClick}>
        <div className={`ride-row-icon ${isCancelled ? 'cancelled' : 'done'}`}>{isCancelled ? '✕' : '✓'}</div>
        <div className="ride-row-body">
          <span className="ride-row-id">{order.order_number || order.reference || order.id.slice(0, 8)}</span>
          {/* Contorul stă în FAŢĂ. Rândul are `text-overflow: ellipsis` şi
              nowrap, iar două adrese germane îl depăşesc de la jumătatea
              primei — pus la coadă, contorul nu se vedea pe niciun telefon. */}
          {tourStops(order).length > 0 && (
            <span className="ride-row-tour">
              {t('tourLabel', lang)} · {tourStops(order).length + 2} {t('tourStopsLabel', lang)}
            </span>
          )}
          <span className="ride-row-route">
            {order.pickup_address} → {order.delivery_address}
          </span>
          {isCancelled ? (
            <span className="ride-row-date">{statusLabel(order.status, lang)}</span>
          ) : completionRefDate(order) && (
            <span className="ride-row-date">{t('delivery', lang)}: {fmtDate(completionRefDate(order))}</span>
          )}
        </div>
        <div className="ride-row-chev">›</div>
      </div>
    )
  }

  const today = isToday(order.pickup_date)
  const tomorrow = isTomorrow(order.pickup_date)

  return (
    <div className="ride-card2">
      <div className="bid-card2-head">
        {isRecentlyNew(order.created_at) && <span className="new-corner">{t('newBadge', lang)}</span>}
        <div className="bid-top-row">
          <div className="bid-top-left">
            <span className="pill-label">{t('pickup', lang)}</span>
            <span className="pill-date">{fmtDate(order.pickup_date)}</span>
            <span className="pill-time">
              {order.pickup_fixed
                ? (order.pickup_time ? `🔒 ${fmtTime(order.pickup_time)}${order.pickup_to ? `–${fmtTime(order.pickup_to)}` : ''}` : '🔒')
                : (order.pickup_from ? `${fmtTime(order.pickup_from)}${order.pickup_to ? `–${fmtTime(order.pickup_to)}` : ''}` : '—')}
            </span>
            {order.is_shuttle && <span className="pill" style={{ background: '#EAF0FB', color: '#2A5299' }}>🚐 Shuttle</span>}
          </div>
          <div className="bid-top-right">
            {today && <span className="pill heute">{t('todayBadge', lang)}</span>}
            {!today && tomorrow && <span className="pill morgen">{t('tomorrowBadge', lang)}</span>}
          </div>
        </div>

        <div className="bid-order-mini">
          {t('orderRef', lang)} {order.order_number || order.reference || order.id.slice(0, 8)}
          <StageBadge order={order} lang={lang} style={{ marginLeft: 8 }} />
        </div>

        <StageProgress order={order} lang={lang} />

        <div className="bid-stop"><span className="addr"><MapPin size={13} strokeWidth={1.8} /> {order.pickup_address}</span></div>
        {/* Cel mult trei rânduri. La douăzeci de opriri, cardul creştea la o
            mie de pixeli — o listă în care nu mai puteai compara două comenzi,
            iar butonul de la bază ieşea de pe ecran. Lista întreagă e pe
            ecranul comenzii, unde îi e locul.
            Fără opacitate pe rând: stingea şi bifa, singurul lucru pentru care
            se citesc rândurile astea. */}
        {tourStops(order).slice(0, 3).map((st) => (
          <div className="bid-stop" key={st.id}>
            <span className="addr" style={{ paddingLeft: 12, color: 'var(--text-soft)', minWidth: 0 }}>
              {st.kind === 'delivery'
                ? <FlagTriangleRight size={12} strokeWidth={1.8} />
                : <MapPin size={12} strokeWidth={1.8} />}
              {' '}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.address}</span>
              {(st.confirmed_at || st.failed_at) && (
                <span style={{ marginLeft: 6, color: st.failed_at ? '#B23A24' : '#1F7A50', fontWeight: 700, flex: '0 0 auto' }}>
                  {st.failed_at ? '✕' : '✓'}
                </span>
              )}
            </span>
          </div>
        ))}
        {tourStops(order).length > 3 && (
          <div className="bid-stop">
            <span className="addr" style={{ paddingLeft: 12, color: 'var(--text-soft)' }}>
              + {tourStops(order).length - 3} {t('stopsMoreLabel', lang)}
            </span>
          </div>
        )}
        <div className="bid-stop"><span className="addr"><FlagTriangleRight size={13} strokeWidth={1.8} /> {order.delivery_address}</span></div>

        <div className="bid-divider" />
        <div className="bid-zustellung-label">{t('delivery', lang)}</div>
        <div className="bid-zustellung-val">
          {order.delivery_fixed ? (
            <span className="fixed-time-badge">🔒 {t('fixedDeliveryBadge', lang)} · {fmtDate(order.delivery_date)}{order.delivery_time ? ` · ${fmtTime(order.delivery_time)}` : ''}</span>
          ) : (
            <>{fmtDate(order.delivery_date)} · {fmtTime(order.delivery_from)}{order.delivery_to ? `–${fmtTime(order.delivery_to)}` : ''}</>
          )}
        </div>

        <div className="bid-cargo-row">
          <VehicleChips vehicles={order.vehicles} />
          <div className="bid-cargo-meta">
            {order.km && <span className="meta-item">📍 {order.km} km</span>}
            {order.weight && <span className="meta-item">⚖ {order.weight} kg</span>}
            {isOwner && effectivePrice(order) != null && <span className="meta-item price">{effectivePrice(order)} €</span>}
          </div>
        </div>
      </div>

      <button className="ride-card2-action" onClick={onClick}>
        👁 {t('viewDetails', lang)}
      </button>
    </div>
  )
}

// Geocodare, o singură implementare.
//
// Varianta anterioară folosea Nominatim (OpenStreetMap), fără cache și fără
// User-Agent. Nominatim limitează la o cerere pe secundă și blochează IP-urile
// care abuzează — iar aici se apela de două ori la FIECARE deschidere de
// comandă, pentru aceleași adrese. În paralel exista deja o geocodare Google
// cu cache, folosită în altă parte a aplicației: două sisteme pentru aceeași
// treabă, dintre care unul riscant.
function useGeocode(address) {
  const [coords, setCoords] = useState(null)
  const mapsKey = useGoogleMapsKey()

  useEffect(() => {
    // Nu mai aşteptăm cheia de browser: dacă lipseşte, geocodarea merge
    // oricum prin server. Înainte, lipsa cheii oprea totul din start.
    if (!address) return
    let active = true
    geocodeAddressCached(address, mapsKey).then((point) => {
      if (active && point) setCoords([point.lat, point.lng])
    })
    return () => { active = false }
  }, [address, mapsKey])

  return coords
}

// Coordonatele mai multor adrese, cu UN singur efect.
//
// `useGeocode` e un hook: chemat o dată per oprire, ar schimba numărul de
// hook-uri de la o randare la alta — exact ce React nu iartă. Aici lista e
// doar un argument.
function useGeocodeMany(addresses) {
  const [puncte, setPuncte] = useState({})
  const mapsKey = useGoogleMapsKey()
  const cheie = (addresses || []).filter(Boolean).join('|')

  useEffect(() => {
    const lista = (addresses || []).filter(Boolean)
    if (!lista.length) return
    let active = true
    // O SINGURĂ scriere de stare la final, nu una per adresă.
    //
    // Cu una per adresă, deschiderea unui tur cu douăzeci de opriri dădea
    // douăzeci de randări, deci douăzeci de desene de hartă şi douăzeci de
    // cereri de traseu la Google — plătite, şi cu polilinia reanimată de
    // douăzeci de ori sub ochii şoferului.
    ;(async () => {
      const rezultate = await Promise.all(
        lista.map((a) => geocodeAddressCached(a, mapsKey).then((pt) => [a, pt]).catch(() => [a, null])),
      )
      if (!active) return
      const gasite = {}
      for (const [a, pt] of rezultate) if (pt) gasite[a] = [pt.lat, pt.lng]
      if (Object.keys(gasite).length) setPuncte((m) => ({ ...gasite, ...m }))
    })()
    return () => { active = false }
  }, [cheie, mapsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return puncte
}

function mapsNavUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

// Numărul de dispecerat Zimand Express, acelaşi din piciorul e-mailurilor
// către firme. WhatsApp, nu telefon: şoferul e în stradă, adesea cu
// mâinile ocupate, iar un mesaj lasă urmă scrisă.
const DISPATCH_WA = '4915510062480'

// Silueta WhatsApp. Lucide nu conţine logo-uri de marcă, iar o bulă de chat
// generică nu spune şoferului unde îl duce butonul.
function WhatsAppIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.38-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35z"/>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 1.8c2.17 0 4.2.84 5.73 2.38a8.05 8.05 0 0 1 2.38 5.73c0 4.47-3.64 8.11-8.11 8.11h-.01c-1.45 0-2.88-.39-4.12-1.13l-.3-.18-3.06.8.82-2.99-.19-.31a8.07 8.07 0 0 1-1.24-4.3c0-4.47 3.64-8.11 8.1-8.11z"/>
    </svg>
  )
}

// Mesajul pleacă deja completat cu numărul comenzii şi adresa etapei
// curente, ca dispeceratul să ştie din prima clipă despre ce e vorba —
// fără schimbul de mesaje „la care comandă?".
// `fapte` vine din `legFacts`: la o oprire de tur, `leg` e un id, nu „pickup"
// sau „delivery" — comparat cu text, mesajul pleca mereu cu adresa de la
// depozitul principal, oriunde s-ar fi aflat şoferul.
function dispatchWaUrl(order, fapte) {
  const ref = order.order_number || order.reference || (order.id || '').slice(0, 8)
  const adresa = fapte?.address || order.pickup_address
  const eticheta = fapte?.kind === 'delivery' ? 'Zustellung' : 'Abholung'
  const text = ref + ' · ' + eticheta + ': ' + (adresa || '') + '\n\n'
  return 'https://wa.me/' + DISPATCH_WA + '?text=' + encodeURIComponent(text)
}

function useGoogleMapsKey() {
  const [key, setKey] = useState(null)
  useEffect(() => {
    supabase.rpc('get_driver_maps_key').then(({ data, error }) => {
      if (error) { console.error('maps key fetch error:', error.message); return }
      setKey(data || null)
    })
  }, [])
  return key
}

let googleMapsLoadPromise = null
function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve()
  if (googleMapsLoadPromise) return googleMapsLoadPromise
  logApiUsage('maps_js', 'Driver App — Kartenladung (einmal pro Sitzung)')
  googleMapsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`
    script.async = true
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
  return googleMapsLoadPromise
}

// Scaner de documente — încărcat leneș, doar când șoferul chiar încarcă un
// document (CMR/Zustellprotokoll/Sonstiges), ca să nu încetinească restul
// aplicației cu un fișier OpenCV de ~8 MB.
let documentScannerLoadPromise = null
function loadDocumentScanner() {
  if (window.jscanify && window.cv?.Mat) return Promise.resolve()
  if (documentScannerLoadPromise) return documentScannerLoadPromise
  documentScannerLoadPromise = new Promise((resolve, reject) => {
    // Găzduite chiar în proiect (public/vendor/) — nu pe niciun server
    // extern, ca la documente sensibile (acte, demisii etc.) codul care
    // rulează pe telefon să fie exact cel aprobat de voi, livrat prin
    // propria infrastructură (GitHub → Vercel), fără intermediari.
    const cvScript = document.createElement('script')
    cvScript.src = '/vendor/opencv.js'
    cvScript.async = true
    cvScript.onerror = reject
    cvScript.onload = () => {
      const readyCheck = () => {
        if (window.cv?.Mat) {
          const jsScript = document.createElement('script')
          jsScript.src = '/vendor/jscanify.js'
          jsScript.async = true
          jsScript.onload = resolve
          jsScript.onerror = reject
          document.head.appendChild(jsScript)
        } else {
          setTimeout(readyCheck, 100)
        }
      }
      readyCheck()
    }
    document.head.appendChild(cvScript)
  })
  return documentScannerLoadPromise
}

// Detectează automat marginile documentului într-o poză și-l "îndreaptă"
// (corectare de perspectivă) — ca o scanare adevărată, nu doar o poză.
// Dacă nu reușește să detecteze o foaie clară, întoarce poza originală
// neschimbată, ca șoferul să nu rămână blocat.
function scanDocument(file) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scanner = new window.jscanify()
        const resultCanvas = scanner.extractPaper(img, img.width, img.height)
        // verificare de sanitate — dacă rezultatul are un raport lățime/înălțime
        // absurd (detectare eșuată, colțuri greșite), nu are cum să fie o foaie
        // reală de document — renunțăm automat, păstrăm poza originală
        const ratio = resultCanvas.width / resultCanvas.height
        if (!resultCanvas.width || !resultCanvas.height || ratio < 0.35 || ratio > 3) {
          resolve({ scanned: null, original: file })
          return
        }
        resultCanvas.toBlob((blob) => {
          if (blob) resolve({ scanned: new File([blob], file.name, { type: 'image/jpeg' }), original: file })
          else resolve({ scanned: null, original: file })
        }, 'image/jpeg', 0.9)
      } catch (e) {
        console.error('document scan error:', e.message)
        resolve({ scanned: null, original: file })
      }
    }
    img.onerror = () => resolve({ scanned: null, original: file })
    img.src = URL.createObjectURL(file)
  })
}

function GoogleLiveMap({ pickupCoords, deliveryCoords, stopCoords }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const directionsRendererRef = useRef(null)
  const markersRef = useRef([])
  const mapsKey = useGoogleMapsKey()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!mapsKey) return
    loadGoogleMaps(mapsKey).then(() => setReady(true)).catch((err) => console.error('google maps load error:', err))
  }, [mapsKey])

  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return
    mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: 49.45, lng: 11.07 },
      zoom: 9,
      disableDefaultUI: true,
      zoomControl: true,
    })
    // suprimăm marcajele implicite ale rutei — punem noi propriile A/B,
    // ca să fie mereu vizibile, indiferent dacă traseul se calculează sau nu
    directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: '#FF7A29', strokeWeight: 4 },
    })
    directionsRendererRef.current.setMap(mapInstanceRef.current)
  }, [ready])

  useEffect(() => {
    const map = mapInstanceRef.current
    const renderer = directionsRendererRef.current
    if (!map || !renderer) return

    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current = []

    function addMarker(coords, label, color) {
      const marker = new window.google.maps.Marker({
        position: { lat: coords[0], lng: coords[1] },
        map,
        label: { text: label, color: '#fff', fontWeight: '700', fontSize: '13px' },
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 14,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      })
      markersRef.current.push(marker)
    }

    // Alb pe #FF7A29 dă 2,6:1 — nelizibil. Aceeaşi familie de portocaliu,
    // închisă cât trebuie ca cifra să se vadă.
    if (pickupCoords) addMarker(pickupCoords, 'A', '#B04A10')
    // Opririle turului, numerotate între cele două capete. Ridicările în
    // portocaliu ca A, livrările în bleumarin ca B — aceeaşi logică de culoare.
    // Eticheta vine de la oprire, nu de la poziţia din listă.
    //
    // Numerotarea după index se schimba pe măsură ce adresele se aflau una
    // după alta, iar o adresă negăsită muta toate numerele de după ea cu unu:
    // semnul „7" era oprirea 8. Acum numărul e acelaşi cu cel de pe card.
    // Portocaliul de dinainte (#E8631A) avea 3,37:1 cu alb — prea slab pentru
    // cifre de 12px peste o hartă, în lumină de zi.
    const intermediare = (stopCoords || []).filter((x) => x && x.coords)
    intermediare.forEach((x, i) => {
      addMarker(x.coords, x.label || String(i + 1), x.kind === 'delivery' ? '#1F4E8C' : '#B04A10')
    })
    if (deliveryCoords) addMarker(deliveryCoords, 'B', '#0F2240')

    if (pickupCoords && deliveryCoords) {
      // Traseul dintre două puncte fixe nu se schimbă. Îl memorăm, altfel se
      // cerea din nou de la Google la fiecare deschidere a comenzii — de zeci
      // de ori pe zi pentru aceeași cursă.
      // Google acceptă până la 23 de puncte intermediare într-o cerere; la un
      // tur mai lung desenăm primele şi lăsăm restul ca semne pe hartă.
      const waypoints = intermediare.slice(0, 23).map((x) => ({
        location: { lat: x.coords[0], lng: x.coords[1] }, stopover: true,
      }))
      const routeKey = [
        `${pickupCoords[0]},${pickupCoords[1]}`,
        ...waypoints.map((w) => `${w.location.lat},${w.location.lng}`),
        `${deliveryCoords[0]},${deliveryCoords[1]}`,
      ].join('|')
      const cachedRoute = directionsCache.get(routeKey)
      if (cachedRoute) { renderer.setDirections(cachedRoute); return }

      logApiUsage('directions', 'Driver App — Live-Karte (Route zeichnen)')
      const directionsService = new window.google.maps.DirectionsService()
      directionsService.route(
        {
          origin: { lat: pickupCoords[0], lng: pickupCoords[1] },
          destination: { lat: deliveryCoords[0], lng: deliveryCoords[1] },
          waypoints,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === 'OK') {
            directionsCache.set(routeKey, result)
            renderer.setDirections(result)
          } else {
            renderer.setDirections({ routes: [] })
            const bounds = new window.google.maps.LatLngBounds()
            bounds.extend({ lat: pickupCoords[0], lng: pickupCoords[1] })
            bounds.extend({ lat: deliveryCoords[0], lng: deliveryCoords[1] })
            map.fitBounds(bounds, 40)
          }
        }
      )
    } else if (pickupCoords) {
      map.setCenter({ lat: pickupCoords[0], lng: pickupCoords[1] })
      map.setZoom(12)
    }
  }, [pickupCoords, deliveryCoords, stopCoords, ready])

  if (!mapsKey || !ready) {
    return <div className="live-map"><div className="live-map-loading">🗺️</div></div>
  }

  return <div className="live-map"><div ref={mapRef} style={{ width: '100%', height: '100%' }} /></div>
}

function ContactRow({ contact, lang }) {
  if (!contact) return null
  const phone = extractPhone(contact)
  const nameOnly = contact.split(' · Tel.')[0].trim()
  return (
    <div className="contact-row">
      <div className="contact-line">
        <span className="contact-text">👤 {nameOnly}</span>
        {phone && (
          <a className="contact-call" href={`tel:${phone.replace(/[\s\-()\/]/g, '')}`}>
            📞 {t('callButton', lang)}
          </a>
        )}
      </div>
      {phone && <div className="contact-phone-line">{phone}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Cardul unei opriri de tur.
   ---------------------------------------------------------------------------
   Aceleaşi clase şi aceeaşi anatomie ca cele patru carduri scrise de mână
   pentru capetele cursei — cap de card, insignă de terminat, pastilă „pe
   drum", corp cu contact, adresă şi buton de navigare. Pe acelea nu le-am
   atins: o cursă obişnuită arată exact ca înainte.
   --------------------------------------------------------------------------- */
function StopLegCard({ order, entry, lang, isCurrent, onOpenConfirm, onFailed }) {
  const f = legFacts(order, entry)
  const nr = legCounter(order, entry)
  const esteLivrare = entry.kind === 'delivery'
  const peDrum = f.startedAt && !f.arrivedAt && !f.confirmedAt && !f.failedAt
  const seDeschide = isCurrent && f.arrivedAt && !f.confirmedAt && !f.failedAt

  // Firma şi persoana, amândouă: „Rewe Markt Bahnhofstraße" e adesea singurul
  // fel de a găsi poarta, iar „Herr Müller" nu ajută la asta. Dacă nu există
  // niciun nume, nu construim un şir care ar afişa telefonul ca nume.
  const numeContact = [f.company, f.contactName].filter(Boolean).join(' · ')
  const contact = numeContact
    ? [numeContact, f.contactPhone ? `· Tel. ${f.contactPhone}` : null].filter(Boolean).join(' ')
    : null

  const interval = f.timeFixed
    ? (f.timeAt ? fmtTime(f.timeAt) : '')
    : [f.timeFrom, f.timeTo].filter(Boolean).map((x) => fmtTime(x)).join('–')

  const acum = isCurrent && !f.confirmedAt && !f.failedAt
  const inchisa = Boolean(f.confirmedAt || f.failedAt)
  // Strânsă, dar nu pierdută: capul se apasă şi cardul revine întreg.
  const [desfasurat, setDesfasurat] = useState(false)
  const strinsa = inchisa && !desfasurat

  // Ecranul sare la oprirea la rând.
  //
  // La douăzeci de opriri, cardul curent poate fi la al şaselea ecran de
  // derulat. Fără asta, şoferul deschide comanda şi vede o oprire pe care a
  // terminat-o acum o oră.
  const cardRef = useRef(null)
  useEffect(() => {
    if (!acum || !cardRef.current) return
    const liniste = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    cardRef.current.scrollIntoView({ block: 'center', behavior: liniste ? 'auto' : 'smooth' })
  }, [acum, entry?.stop?.id])

  return (
    <div ref={cardRef} className={`info-card ${acum ? 'stop-now' : ''}`}>
      <div
        className={`info-card-head leg-head-line ${peDrum ? 'en-route' : ''}`}
        {...(seDeschide
          ? { onClick: onOpenConfirm, style: { cursor: 'pointer' } }
          : inchisa
            ? { onClick: () => setDesfasurat((v) => !v), style: { cursor: 'pointer' }, title: t('stopReopenHint', lang) }
            : {})}
      >
        <span className="leg-head-left">
          {esteLivrare ? '🅑' : '🅐'} {esteLivrare ? t('delivery', lang) : t('pickup', lang)}
          {nr ? ` ${nr.n} / ${nr.total}` : ''}
          {(f.date || interval) && (
            <span className="leg-head-time">
              {' · '}
              {f.date ? fmtDate(f.date) : ''}
              {interval ? `${f.date ? ' · ' : ''}` : ''}
              {interval && (f.timeFixed
                ? <strong className="leg-head-fix">🔒 {interval}</strong>
                : interval)}
            </span>
          )}
        </span>
        {f.confirmedAt && (
          <span className="leg-done-badge">✓ {esteLivrare ? t('deliveredLabel', lang) : t('pickedUpLabel', lang)}</span>
        )}
        {f.failedAt && (
          <span className="leg-done-badge failed">
            ✕ {t('stopFailedLabel', lang)}
          </span>
        )}
        {peDrum && (
          <span className="leg-en-route-pill">{t('enRouteLabel', lang)} <span className="moving-van">🚚</span></span>
        )}
        {acum && !peDrum && <span className="stop-now-pill">{t('stopNowLabel', lang)}</span>}
      </div>
      {/* Același însemn, pe oprirea la care stă curierul. La un tur cu
          douăzeci de opriri, un cuvânt în antet nu spune la care anume. */}
      {seDeschide && (
        <div
          onClick={onOpenConfirm}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, flexWrap: 'wrap', cursor: 'pointer',
            background: '#FFF6ED', borderTop: '1px solid #FFD2AE', borderBottom: '1px solid #FFD2AE',
            padding: '8px 12px',
          }}
        >
          <StageBadge order={order} lang={lang} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#B35A12', whiteSpace: 'nowrap' }}>
            {t('stepOpenLabel', lang)} →
          </span>
        </div>
      )}
      <div className="info-card-body">
        {strinsa ? (
          <div className="stop-closed-line">
            <span className="address-text">{f.address || '—'}</span>
            <span className="stop-closed-time">
              {f.confirmedAt ? `✓ ${fmtDateTime(f.confirmedAt)}` : `✕ ${fmtDateTime(f.failedAt)}`}
              {' · '}{t('stopReopenHint', lang)}
            </span>
          </div>
        ) : (
          <>
            <ContactRow contact={contact} lang={lang} />
            <div className="info-row address-row">
              <span className="address-text">{f.address || '—'}</span>
              {f.address && (
                <a className="maps-nav-btn" href={mapsNavUrl(f.address)} target="_blank" rel="noreferrer">
                  <Navigation size={13} strokeWidth={2.2} /> {t('navigateButton', lang)}
                </a>
              )}
            </div>
            {f.confirmedAt && <div className="info-row-time">✓ {fmtDateTime(f.confirmedAt)}</div>}
            {f.failedAt && <div className="info-row-time" style={{ color: '#8A2A17' }}>✕ {fmtDateTime(f.failedAt)}</div>}
          </>
        )}
        {f.failedAt && f.failedReason && (
          <div className="leg-notiz" style={{ background: '#FDECEA', borderColor: '#D98375', color: '#8A2A17' }}>
            {f.failedReason}
          </div>
        )}
        {/* Marfa se vede mereu — e motivul opririi. Referinţa şi menţiunea
            pentru şofer doar la oprirea la rând şi la cele încheiate: la
            douăzeci de opriri, trei casete pe fiecare card adăugau vreo mie
            opt sute de pixeli pe care nimeni nu-i citeşte în avans. */}
        {!strinsa && (f.cargo || f.weightKg) && (
          <div className="leg-notiz">
            📦 {[f.cargo, f.weightKg ? `${f.weightKg} kg` : null].filter(Boolean).join(' · ')}
          </div>
        )}
        {(acum || desfasurat) && f.reference && <div className="leg-notiz">🧾 {f.reference}</div>}
        {(acum || desfasurat) && f.note && <div className="leg-notiz">📝 {f.note}</div>}
        {isCurrent && !f.confirmedAt && !f.failedAt && onFailed && (
          <button
            type="button"
            className="link-btn danger-link"
            onClick={onFailed}
          >
            ✕ {t('stopFailedButton', lang)}
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   „Oprirea n-a fost posibilă".
   ---------------------------------------------------------------------------
   Nu e nimeni, e închis, marfa e refuzată. Fără asta, oprirea rămâne pe veci
   deschisă şi — fiindcă baza de date nu lasă turul să se încheie cu opriri
   fără dovadă — şoferul ar rămâne blocat în faţa unei uşi închise.
   --------------------------------------------------------------------------- */
function StopFailedSheet({ stop, orderId, lang, onClose, onSaved }) {
  const [motiv, setMotiv] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sumar, setSumar] = useState({ total: 0, allDone: false, photoCount: 0 })
  const fileRef = useRef(null)

  async function salveaza() {
    if (!motiv.trim()) { setError(t('stopFailedMissingReason', lang)); return }
    if (sumar.photoCount < 1) { setError(t('stopFailedMissingPhoto', lang)); return }
    // Nu mai aşteptăm aici. Coada aşteaptă poza în locul nostru: dacă nu
    // ajunge sus la timp, raportul rămâne pe telefon întreg şi pleacă singur.
    //
    // Blocarea de dinainte se potrivea cu subsolul, dar nu şi cu cazul
    // obişnuit al unui telefon în mişcare: o bară de semnal, cu care
    // `navigator.onLine` spune „sunt online" şi poza tot nu urcă. Acolo
    // butonul rămânea blocat şi şoferul nu putea raporta deloc — iar fără
    // raport, turul nu se mai putea încheia.
    setBusy(true)
    setError('')
    // Căile pozelor deja urcate, din coada din telefon — acelaşi mecanism ca
    // la confirmarea unei etape, deci şi aici o poză făcută în subsol se urcă
    // singură când revine semnalul.
    // Raportul merge prin coadă, ca o confirmare. Fără semnal rămâne pe
    // telefon şi pleacă singur când revine — înainte, apăsarea cădea cu o
    // eroare şi oprirea rămânea deschisă, deşi şoferul fusese acolo, scrisese
    // motivul şi făcuse poza. Ştergerea unei confirmări rămase în aşteptare
    // pentru aceeaşi oprire se face acum înăuntru, pe amândouă drumurile.
    let rezultat
    try {
      rezultat = await reportStopFailed({ orderId, stopId: stop.id, reason: motiv.trim() })
    } catch (err) {
      setBusy(false)
      console.error('stop failed report:', err?.message || err)
      setError(t('stopFailedFailed', lang))
      return
    }
    setBusy(false)
    onSaved(motiv.trim(), rezultat === 'pending')
  }

  const sheet = {
    background: '#fff', borderRadius: '16px 16px 0 0',
    padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
    maxHeight: '92vh', overflowY: 'auto',
  }

  return (
    <div className="sig-fullscreen" style={{ justifyContent: 'flex-end', background: 'rgba(15,34,64,.55)' }}>
      <div style={sheet}>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 17, color: '#0F2240', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 4 }}>
          {t('stopFailedTitle', lang)}
        </div>
        {/* #6B7A90 pe alb dă 4,36:1 — sub pragul de 4,5:1, iar asta e chiar
            textul care explică un gest fără întoarcere. */}
        <p style={{ fontSize: 13.5, color: '#5A6878', margin: '0 0 16px', lineHeight: 1.5 }}>
          {t('stopFailedNote', lang)}
        </p>

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#5A6878', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
          {t('stopFailedReason', lang)}
        </label>
        {/* 16px, nu 15: sub 16px, Safari pe iPhone măreşte singur pagina la
            atingerea câmpului şi n-o mai micşorează. */}
        <textarea
          rows={3}
          value={motiv}
          onChange={(e) => setMotiv(e.target.value)}
          placeholder={t('stopFailedReasonPlaceholder', lang)}
          style={{ width: '100%', padding: '11px 12px', fontSize: 16, border: '1px solid #D8DEE8', borderRadius: 8, resize: 'vertical' }}
        />

        {/* Dovada. Aceeaşi componentă şi aceeaşi coadă de urcare ca la
            confirmarea unei etape. */}
        <div style={{ marginTop: 14 }}>
          <PodFiles
            orderId={orderId}
            leg={stop.id}
            lang={lang}
            maxPhotos={2}
            onAddPhoto={() => fileRef.current?.click()}
            onSummary={setSumar}
            photoHints={[t('stopFailedPhotoHint', lang)]}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = Array.from(e.target.files || [])
              if (f.length) enqueueFiles(orderId, stop.id, f, { kind: 'photo' })
              e.target.value = ''
            }}
          />
        </div>

        {error && <div style={{ color: '#B23A24', fontSize: 12.5, marginTop: 8 }}>{error}</div>}

        <button className="btn danger-solid" onClick={salveaza}
                disabled={busy || !motiv.trim() || sumar.photoCount < 1}
                style={{ width: '100%', marginTop: 14 }}>
          {busy ? t('stopFailedSaving', lang) : t('stopFailedSave', lang)}
        </button>
        <button type="button" className="link-btn" onClick={onClose} disabled={busy} style={{ marginTop: 8 }}>
          {t('back', lang)}
        </button>
      </div>
    </div>
  )
}

function RideDetailScreen({ order: orderProp, isOwner, session, lang, onBack, onStatusChange, onDeliveryComplete, profile }) {
  // Actualizare optimistă — de îndată ce un buton (Losfahren/Angekommen/
  // confirmare) reușește, marcăm local, imediat, fără să așteptăm ca
  // sincronizarea live (Realtime) să confirme din baza de date — asta
  // dădea senzația de aplicație lentă la fiecare apăsare.
  // Marcarea locală are termen de viaţă.
  //
  // Înainte se ştergea numai la schimbarea comenzii. Dacă dispeceratul
  // desfăcea o confirmare (poze proaste, de refăcut), valoarea locală se
  // punea peste cea de la server şi oprirea rămânea bifată pe telefon —
  // fără nicio cale de a o redeschide. După treizeci de secunde, serverul
  // are ultimul cuvânt, cum se cuvine.
  const OPTIMIST_MS = 30000
  const [optimistic, setOptimistic] = useState({})
  // Opririle turului se marchează separat: ele nu stau pe comandă, ci pe
  // rândurile lor. Fără asta, confirmarea unei opriri n-ar muta etapa până la
  // următoarea reîncărcare — şoferul ar apăsa şi nu s-ar întâmpla nimic.
  const [optimisticStops, setOptimisticStops] = useState({})
  const acumMs = Date.now()
  const proaspete = (m) => {
    const out = {}
    for (const k of Object.keys(m || {})) {
      const e = m[k]
      if (e && typeof e === 'object' && 'at' in e && (e.at === Infinity || acumMs - e.at < OPTIMIST_MS)) out[k] = e.v
    }
    return out
  }
  const orderBaza = { ...orderProp, ...proaspete(optimistic) }
  const peticOpriri = {}
  for (const id of Object.keys(optimisticStops)) {
    const p = proaspete(optimisticStops[id])
    if (Object.keys(p).length) peticOpriri[id] = p
  }
  const order = Object.keys(peticOpriri).length
    ? {
        ...orderBaza,
        trip_stops: (orderBaza.trip_stops || []).map((st) =>
          peticOpriri[st.id] ? { ...st, ...peticOpriri[st.id] } : st),
      }
    : orderBaza
  useEffect(() => { setOptimistic({}); setOptimisticStops({}) }, [orderProp.id])
  // value === null înseamnă "am anulat etapa" — câmpul trebuie să apară gol
  // imediat, altfel interfața ar rămâne o clipă pe etapa anulată.
  //
  // `fara_expirare` e pentru confirmările rămase în coadă: acolo adevărul e pe
  // telefon, nu pe server, iar marcajul trebuie să ţină până la reîncărcare.
  const setOptimisticField = (field, value, faraExpirare = false) =>
    setOptimistic((o) => ({ ...o, [field]: { v: value === null ? null : new Date().toISOString(), at: faraExpirare ? Infinity : Date.now() } }))
  const setOptimisticStopField = (stopId, field, value, faraExpirare = false) =>
    setOptimisticStops((m) => ({
      ...m,
      [stopId]: { ...(m[stopId] || {}), [field]: { v: value === null ? null : new Date().toISOString(), at: faraExpirare ? Infinity : Date.now() } },
    }))
  const pickupCoords = useGeocode(order.pickup_address)
  const deliveryCoords = useGeocode(order.delivery_address)
  const companyName = useCompanyName(order.created_by)
  const companyProfileId = useCompanyProfileId(session, null)
  const [companyDrivers, setCompanyDrivers] = useState([])
  const pickupContact = extractContact(order.notes, 'Kontakt Abholung: ')
  const deliveryContact = extractContact(order.notes, 'Kontakt Zustellung: ')
  const pickupNotiz = extractContact(order.notes, 'Notiz Abholung: ')
  const deliveryNotiz = extractContact(order.notes, 'Notiz Zustellung: ')
  const [cargoOpen, setCargoOpen] = useState(false)
  const [opriseEsuata, setOprireEsuata] = useState(null)
  const [reassigning, setReassigning] = useState(false)
  const [reassignTo, setReassignTo] = useState('')

  useEffect(() => {
    if (!isOwner || !companyProfileId) return
    supabase
      .from('drivers')
      .select('id, name, plate, active')
      .eq('company_id', companyProfileId)
      .then(({ data }) => setCompanyDrivers((data || []).filter((d) => d.active !== false && d.id !== order.assigned_driver_id)))
  }, [isOwner, companyProfileId, order.assigned_driver_id])

  async function reassignDriver() {
    if (!reassignTo) return
    setReassigning(true)
    // Atribuirea trece prin funcţia din bază, nu printr-un UPDATE direct.
    // Un UPDATE cu `.eq('id', ...)` are nevoie şi de drept de CITIRE pe rândul
    // acela — pe care firma nu-l mai are — iar PostgREST răspunde 204 şi când
    // n-a schimbat nimic. Butonul ar fi arătat verde fără să fi atribuit pe
    // nimeni. Funcţia verifică şi câştigătorul, şi că şoferul e al firmei, şi
    // aruncă o eroare adevărată la refuz.
    const { error } = await supabase.rpc('courier_assign_driver', {
      p_order_id: order.id,
      p_driver_id: reassignTo,
    })
    setReassigning(false)
    if (error) {
      console.error('reassign error:', error.message)
      alert(error.message)
      return
    }
    onStatusChange()
    onBack()
  }

  // Etapa curentă: prima din listă care n-are nici confirmare, nici motiv de
  // eşec. Înainte era un lanţ de patru ramuri scris de mână; acum lista poate
  // avea oricâte opriri, iar o cursă obişnuită A→B dă exact aceleaşi două
  // etape ca înainte.
  const legEntry = currentLegEntry(order)
  const leg = legEntry.key
  const legFapte = legFacts(order, legEntry)
  const startedAt = legFapte.startedAt
  const arrivedAt = legFapte.arrivedAt
  const confirmedAt = legFapte.confirmedAt
  // Marcarea locală merge în locul potrivit: pe comandă sau pe rândul opririi.
  const onLegStatusChange = (field, value, faraExpirare = false) => {
    if (legEntry.stop) setOptimisticStopField(legEntry.stop.id, field, value, faraExpirare)
    else setOptimisticField(field, value, faraExpirare)
  }
  // Opririle suplimentare, pentru cardurile dintre cele două capete.
  const opririTur = tourStops(order)
  // Ordinea cardurilor trebuie să fie ordinea de MERS, nu cea din bază.
  //
  // `tourStops` dă poziţiile aşa cum le-a scris dispeceratul, care pot fi
  // amestecate (ridicare, livrare, ridicare…). Dar se conduce altfel: întâi
  // toate ridicările, apoi toate livrările. Cu două liste diferite, etapa
  // curentă sărea peste carduri, iar lista de pe ecran nu era traseul.
  const secventaOpriri = tourLegSequence(order).filter((e) => e.stop)
  // Coordonatele lor, pentru harta cu traseul adevărat. Dacă dispeceratul le-a
  // salvat pe rând, le folosim de acolo; altfel le aflăm o dată şi rămân în
  // memoria sesiunii.
  const coordOpririDupaAdresa = useGeocodeMany(opririTur.map((st) => st.address))
  // Memorat: fără asta, lista era un obiect nou la fiecare randare, iar harta
  // se dărâma şi se redesena de fiecare dată.
  const puncteOpriri = useMemo(() => secventaOpriri
    .map((e) => {
      const st = e.stop
      const c = legCounter(order, e)
      return {
        kind: st.kind,
        label: `${st.kind === 'delivery' ? 'B' : 'A'}${c ? c.n : ''}`,
        coords: (st.lat != null && st.lng != null) ? [st.lat, st.lng] : coordOpririDupaAdresa[st.address],
      }
    })
    .filter((x) => x.coords),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(secventaOpriri.map((e) => [e.stop.id, e.stop.kind, e.stop.address, e.stop.lat, e.stop.lng])), coordOpririDupaAdresa])

  // Tur sau cursă obişnuită. De asta atârnă bara lipită de sus, rama „ACUM"
  // pe cele două capete şi săritura ecranului la livrarea finală: la o cursă
  // de la A la B niciuna nu intră în joc şi ecranul rămâne cel de până acum.
  const esteTur = secventaOpriri.length > 0

  // Livrarea finală e randată după toate opririle. Când îi venea rândul,
  // ecranul rămânea unde era — la a douăzecea oprire, încheiată — şi şoferul
  // derula în jos căutând ceva portocaliu.
  const cardLivrareRef = useRef(null)
  const livrareLaRand = esteTur && leg === 'delivery' && !order.delivery_confirmed_at
  useEffect(() => {
    if (!livrareLaRand || !cardLivrareRef.current) return
    const liniste = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    cardLivrareRef.current.scrollIntoView({ block: 'center', behavior: liniste ? 'auto' : 'smooth' })
  }, [livrareLaRand])

  // Formularul de confirmare (poze/documente/nume/semnătură) se deschide
  // automat de îndată ce șoferul a ajuns la locație. "Zurück" în acest
  // pas special NU trebuie să scoată șoferul din comandă — doar închide
  // formularul, ca să revadă detaliile (adresă, marfă), fără să piardă
  // progresul deja înregistrat ("Angekommen" rămâne bifat). Apăsând din
  // nou pe caseta etapei active, formularul se redeschide.
  const [confirmFormOpen, setConfirmFormOpen] = useState(true)
  const inConfirmStep = order.status === 'assigned' && !!arrivedAt && !confirmedAt

  // „An Abholung angekommen“, scris pe cardul etapei la care stă curierul —
  // nu sus, lângă „Zurück“.
  //
  // Sus era un cuvânt despre altceva decât ce se vedea dedesubt: scria
  // „angekommen“, iar sub el două carduri la fel, fără să spună la CARE
  // dintre ele. Acum însemnul stă pe cardul respectiv, sub data și ora, și
  // duce înapoi la pasul cu pozele la o atingere — fiindcă exact de acolo a
  // ieșit curierul când a apăsat „Zurück“.
  //
  // Celălalt card nu se aprinde și nu duce nicăieri: nu e rândul lui.
  const stareCursa = operationalStage(order)
  const insemnEtapa = (cheie) => {
    const e = stareCursa.leg
    if (!e || e.stop || e.key !== cheie) return null
    const f = legFacts(order, e)
    if (!f.arrivedAt || f.confirmedAt || f.failedAt) return null
    return (
      <div
        onClick={() => setConfirmFormOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, flexWrap: 'wrap', cursor: 'pointer',
          background: '#FFF6ED', border: '1px solid #FFD2AE', borderRadius: 9,
          padding: '8px 10px', margin: '0 0 10px',
        }}
      >
        <StageBadge order={order} lang={lang} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#B35A12', whiteSpace: 'nowrap' }}>
          {t('stepOpenLabel', lang)} →
        </span>
      </div>
    )
  }

  function handleBack() {
    if (inConfirmStep && confirmFormOpen) {
      setConfirmFormOpen(false)
      return
    }
    onBack()
  }

  return (
    <div className="ride-detail">
      {/* Sus doar „Zurück" și ceasul de așteptare. Restul a coborât acolo
          unde e căutat: numărul comenzii și hârtiile în cardul Fracht,
          legătura cu dispeceratul sub butonul de confirmare, iar însemnul
          „a ajuns" pe cardul etapei la care stă curierul. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="back-btn" style={{ margin: 0, alignSelf: 'center' }} onClick={handleBack}>← {t('back', lang)}</button>
        {/* Wartezeit, calculată din ora sosirii — nu dintr-un cronometru ţinut
            în memorie: dacă șoferul reîncarcă aplicaţia, timpul rămâne corect.
            Stătea în pasul cu pozele, deci dispărea de sub ochi exact când
            șoferul ieșea să se uite la comandă. Aici merge mai departe. */}
        {arrivedAt && !confirmedAt && (
          <span
            title={t('waitingTime', lang)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(15,34,64,.08)', borderRadius: 10,
              padding: '8px 12px', whiteSpace: 'nowrap', alignSelf: 'center',
              marginLeft: 'auto',
            }}
          >
            <span style={{ fontSize: 14 }}>⏱</span>
            <ElapsedTimer startedAt={arrivedAt} compact />
          </span>
        )}
      </div>

      {/* Bara de progres rămâne lipită sus la tururi. Goală n-o mai desenăm:
          altfel rămânea o dungă fără nimic în ea. */}
      {(stageProgress(order)?.done || 0) > 0 && (
        <div className={`ride-head-group ${secventaOpriri.length > 0 ? 'ride-sticky-head' : ''}`}>
          <StageProgress order={order} lang={lang} />
        </div>
      )}

      <GoogleLiveMap pickupCoords={pickupCoords} deliveryCoords={deliveryCoords} stopCoords={puncteOpriri} />

      {companyName && (
        <div className="info-card">
          <div className="info-card-head">🏢 {companyName}</div>
        </div>
      )}

      {opriseEsuata && (
        <StopFailedSheet
          stop={opriseEsuata}
          orderId={order.id}
          lang={lang}
          onClose={() => setOprireEsuata(null)}
          onSaved={(motiv, inAsteptare) => {
            // Marcăm local, imediat: etapa trece la următoarea oprire fără să
            // aşteptăm reîncărcarea.
            //
            // Când raportul aşteaptă semnal, semnul NU expiră. Cu termenul de
            // treizeci de secunde, oprirea reapărea deschisă după o jumătate
            // de minut, deşi şoferul o raportase — iar el ar fi raportat-o a
            // doua oară, sau ar fi crezut că nu s-a salvat.
            const laMs = inAsteptare ? Infinity : Date.now()
            setOptimisticStops((m) => ({
              ...m,
              [opriseEsuata.id]: {
                ...(m[opriseEsuata.id] || {}),
                failed_at: { v: new Date().toISOString(), at: laMs },
                failed_reason: { v: motiv, at: laMs },
              },
            }))
            setOprireEsuata(null)
            setConfirmFormOpen(false)
          }}
        />
      )}

      {order.status === 'assigned' && !confirmedAt && confirmFormOpen && (
        <LegWorkflow key={leg} order={order} leg={leg} legEntry={legEntry} lang={lang} startedAt={startedAt} arrivedAt={arrivedAt} onStatusChange={onLegStatusChange} isOwner={isOwner} profile={profile} onStopFailed={legEntry.stop ? () => setOprireEsuata(legEntry.stop) : undefined} onDeliveryComplete={() => onDeliveryComplete(isOwner ? (earningsAmount(order) || null) : null)} />
      )}

      {!(inConfirmStep && confirmFormOpen) && (
      <>
      <div className={`info-card ${esteTur && leg === 'pickup' && !order.pickup_confirmed_at ? 'stop-now' : ''}`}>
        <div
          className={`info-card-head leg-head-line ${order.pickup_started_at && !order.pickup_arrived_at ? 'en-route' : ''}`}
          {...(leg === 'pickup' && arrivedAt && !confirmedAt ? { onClick: () => setConfirmFormOpen(true), style: { cursor: 'pointer' } } : {})}
        >
          <span className="leg-head-left">
            🅐 {t('pickup', lang)}{(() => { const c = legCounter(order, { key: 'pickup', kind: 'pickup', stop: null }); return c ? ` ${c.n} / ${c.total}` : '' })()}
            {order.pickup_date && (
              <span className="leg-head-time">
                {' · '}
                {order.pickup_fixed ? `🔒 ${t('fixedPickupBadge', lang)} · ` : ''}
                {fmtDate(order.pickup_date)}
                {order.pickup_fixed ? (order.pickup_time ? ` · ${fmtTime(order.pickup_time)}${order.pickup_to ? `–${fmtTime(order.pickup_to)}` : ''}` : '') : (order.pickup_from ? ` · ${fmtTime(order.pickup_from)}${order.pickup_to ? `–${fmtTime(order.pickup_to)}` : ''}` : '')}
              </span>
            )}
          </span>
          {order.pickup_confirmed_at && <span className="leg-done-badge">✓ {t('pickedUpLabel', lang)}</span>}
          {esteTur && leg === 'pickup' && !order.pickup_confirmed_at && (
            <span className="stop-now-pill">{t('stopNowLabel', lang)}</span>
          )}
          {order.pickup_started_at && !order.pickup_arrived_at && (
            <span className="leg-en-route-pill">{t('enRouteLabel', lang)} <span className="moving-van">🚚</span></span>
          )}
        </div>
        <div className="info-card-body">
          {insemnEtapa('pickup')}
          <ContactRow contact={pickupContact} lang={lang} />
          <div className="info-row address-row">
            <span className="address-text">{order.pickup_address}</span>
            <a className="maps-nav-btn" href={mapsNavUrl(order.pickup_address)} target="_blank" rel="noreferrer"><Navigation size={13} strokeWidth={2.2} /> {t('navigateButton', lang)}</a>
          </div>
          {order.pickup_confirmed_at && <div className="info-row-time">✓ {fmtDateTime(order.pickup_confirmed_at)}</div>}
          {order.flexible_time_notes && (
            <div className="flex-time-note" style={{ marginTop: 8 }}>
              ⏱ {formatFlexibleTimeNote(order.flexible_time_notes).main}
            </div>
          )}
          {pickupNotiz && <div className="leg-notiz">📝 {pickupNotiz}</div>}
          {order.pickup_alt_date && (
            <div style={{ background: '#FFF6ED', border: '1px solid #FF7A29', borderRadius: 6, padding: '6px 10px', marginTop: 6, fontSize: 12.5, color: '#E8631A', fontWeight: 600 }}>
              ⏰ {t('altTimeLabel', lang)}: {fmtDate(order.pickup_alt_date)} {order.pickup_alt_from ? `${fmtTime(order.pickup_alt_from)}${order.pickup_alt_to ? `–${fmtTime(order.pickup_alt_to)}` : ''}` : ''}
            </div>
          )}
        </div>
      </div>

      {/* Opririle turului, între cele două capete: întâi ridicările
          suplimentare, apoi livrările suplimentare, apoi livrarea
          principală — chiar ordinea în care se conduc. La o cursă obişnuită
          lista e goală şi nu se randează nimic. */}
      {secventaOpriri.map((intrare) => {
        const st = intrare.stop
        return (
          <StopLegCard
            key={st.id}
            order={order}
            entry={intrare}
            lang={lang}
            isCurrent={legEntry.key === st.id}
            onOpenConfirm={() => setConfirmFormOpen(true)}
            onFailed={() => setOprireEsuata(st)}
          />
        )
      })}

      <div ref={cardLivrareRef} className={`info-card ${esteTur && leg === 'delivery' && !order.delivery_confirmed_at ? 'stop-now' : ''}`}>
        <div
          className={`info-card-head leg-head-line ${order.delivery_started_at && !order.delivery_arrived_at ? 'en-route' : ''}`}
          {...(leg === 'delivery' && arrivedAt && !confirmedAt ? { onClick: () => setConfirmFormOpen(true), style: { cursor: 'pointer' } } : {})}
        >
          <span className="leg-head-left">
            🅑 {t('delivery', lang)}{(() => { const c = legCounter(order, { key: 'delivery', kind: 'delivery', stop: null }); return c ? ` ${c.n} / ${c.total}` : '' })()}
            {order.delivery_date && (
              <span className="leg-head-time">
                {' · '}
                {order.delivery_fixed ? `🔒 ${t('fixedDeliveryBadge', lang)} · ` : ''}
                {fmtDate(order.delivery_date)}
                {order.delivery_fixed ? (order.delivery_time ? ` · ${fmtTime(order.delivery_time)}` : '') : (order.delivery_from ? ` · ${fmtTime(order.delivery_from)}${order.delivery_to ? `–${fmtTime(order.delivery_to)}` : ''}` : '')}
              </span>
            )}
          </span>
          {order.delivery_confirmed_at && <span className="leg-done-badge">✓ {t('deliveredLabel', lang)}</span>}
          {esteTur && leg === 'delivery' && !order.delivery_confirmed_at && (
            <span className="stop-now-pill">{t('stopNowLabel', lang)}</span>
          )}
          {order.delivery_started_at && !order.delivery_arrived_at && (
            <span className="leg-en-route-pill">{t('enRouteLabel', lang)} <span className="moving-van">🚚</span></span>
          )}
        </div>
        <div className="info-card-body">
          {insemnEtapa('delivery')}
          <ContactRow contact={deliveryContact} lang={lang} />
          <div className="info-row address-row">
            <span className="address-text">{order.delivery_address}</span>
            <a className="maps-nav-btn" href={mapsNavUrl(order.delivery_address)} target="_blank" rel="noreferrer"><Navigation size={13} strokeWidth={2.2} /> {t('navigateButton', lang)}</a>
          </div>
          {order.delivery_confirmed_at && <div className="info-row-time">✓ {fmtDateTime(order.delivery_confirmed_at)}</div>}
          {deliveryNotiz && <div className="leg-notiz">📝 {deliveryNotiz}</div>}
          {order.delivery_alt_date && (
            <div style={{ background: '#FFF6ED', border: '1px solid #FF7A29', borderRadius: 6, padding: '6px 10px', marginTop: 6, fontSize: 12.5, color: '#E8631A', fontWeight: 600 }}>
              ⏰ {t('altTimeLabel', lang)}: {fmtDate(order.delivery_alt_date)} {order.delivery_alt_from ? `${fmtTime(order.delivery_alt_from)}${order.delivery_alt_to ? `–${fmtTime(order.delivery_alt_to)}` : ''}` : ''}
            </div>
          )}
        </div>
      </div>

      {order.is_round_trip && (
        <>
          <div className="info-card">
            <div
              className={`info-card-head leg-head-line ${order.return_pickup_started_at && !order.return_pickup_arrived_at ? 'en-route' : ''}`}
              {...(leg === 'return_pickup' && arrivedAt && !confirmedAt ? { onClick: () => setConfirmFormOpen(true), style: { cursor: 'pointer' } } : {})}
            >
              <span className="leg-head-left">
                🔁🅐 {t('pickup', lang)} ({t('returnLabel', lang)})
                {order.return_pickup_date && (
                  <span className="leg-head-time">
                    {' · '}
                    {fmtDate(order.return_pickup_date)}
                    {order.return_pickup_from ? ` · ${fmtTime(order.return_pickup_from)}${order.return_pickup_to ? `–${fmtTime(order.return_pickup_to)}` : ''}` : ''}
                  </span>
                )}
              </span>
              {order.return_pickup_confirmed_at && <span className="leg-done-badge">✓ {t('pickedUpLabel', lang)}</span>}
              {order.return_pickup_started_at && !order.return_pickup_arrived_at && (
                <span className="leg-en-route-pill">{t('enRouteLabel', lang)} <span className="moving-van">🚚</span></span>
              )}
            </div>
            <div className="info-card-body">
              {insemnEtapa('return_pickup')}
              <div className="info-row address-row">
                <span className="address-text">{order.return_pickup_address}</span>
                <a className="maps-nav-btn" href={mapsNavUrl(order.return_pickup_address)} target="_blank" rel="noreferrer"><Navigation size={13} strokeWidth={2.2} /> {t('navigateButton', lang)}</a>
              </div>
              {order.return_pickup_confirmed_at && <div className="info-row-time">✓ {fmtDateTime(order.return_pickup_confirmed_at)}</div>}
              {order.return_cargo_desc && <div className="leg-notiz">📝 {order.return_cargo_desc}</div>}
            </div>
          </div>

          <div className="info-card">
            <div
              className={`info-card-head leg-head-line ${order.return_delivery_started_at && !order.return_delivery_arrived_at ? 'en-route' : ''}`}
              {...(leg === 'return_delivery' && arrivedAt && !confirmedAt ? { onClick: () => setConfirmFormOpen(true), style: { cursor: 'pointer' } } : {})}
            >
              <span className="leg-head-left">
                🔁🅑 {t('delivery', lang)} ({t('returnLabel', lang)})
              </span>
              {order.return_delivery_confirmed_at && <span className="leg-done-badge">✓ {t('deliveredLabel', lang)}</span>}
              {order.return_delivery_started_at && !order.return_delivery_arrived_at && (
                <span className="leg-en-route-pill">{t('enRouteLabel', lang)} <span className="moving-van">🚚</span></span>
              )}
            </div>
            <div className="info-card-body">
              {insemnEtapa('return_delivery')}
              <div className="info-row address-row">
                <span className="address-text">{order.return_delivery_address}</span>
                <a className="maps-nav-btn" href={mapsNavUrl(order.return_delivery_address)} target="_blank" rel="noreferrer"><Navigation size={13} strokeWidth={2.2} /> {t('navigateButton', lang)}</a>
              </div>
              {order.return_delivery_confirmed_at && <div className="info-row-time">✓ {fmtDateTime(order.return_delivery_confirmed_at)}</div>}
            </div>
          </div>
        </>
      )}
      </>
      )}

      <div className="info-card">
        <div className="info-card-head cargo-toggle" onClick={() => setCargoOpen((v) => !v)}>
          {/* Numărul comenzii, coborât aici din antet: sus începea fiecare
              ecran cu un rând pe care șoferul nu-l citește — îl caută doar
              când sună la dispecerat. */}
          <span>📦 {t('cargoLabel', lang)}
            <span style={{
              marginLeft: 8, fontFamily: 'monospace', fontSize: 11.5,
              fontWeight: 600, color: 'var(--text-soft, #6B7A90)', letterSpacing: '.02em',
            }}>
              {order.order_number || order.reference || order.id.slice(0, 8)}
            </span>
          </span>
          <span className={`cargo-chev ${cargoOpen ? 'open' : ''}`}>▼</span>
        </div>
        {cargoOpen && (
          <div className="info-card-body">
            {cargoSummary(order) && <div className="info-row"><span className="k">📦</span><span className="v">{cargoSummary(order)}</span></div>}
            {order.cargo_desc && <div className="info-row"><span className="k">{t('cargoLabel', lang)}</span><span className="v">{order.cargo_desc}</span></div>}
            {order.weight && <div className="info-row"><span className="k">{t('weightLabel', lang)}</span><span className="v">{order.weight} kg</span></div>}
            {order.dims && <div className="info-row"><span className="k">{t('dimsLabel', lang)}</span><span className="v">{order.dims}</span></div>}
            {order.km && <div className="info-row"><span className="k">{t('kmLabel', lang)}</span><span className="v">{order.km} km</span></div>}
            {order.reference && <div className="info-row"><span className="k">{t('referenceLabel', lang)}</span><span className="v">{order.reference}</span></div>}
            {extractServiceBadges(order.notes).length > 0 && (
              <div className="service-badges">
                {extractServiceBadges(order.notes).map((b, i) => (
                  <span key={b.key || i} className={`service-badge${b.warn ? ' warn' : ''}`}>{b.icon} {b.key ? t(b.key, lang) : b.text}</span>
                ))}
              </div>
            )}
            {order.notes && driverSafeNotesWithoutContacts(order.notes) && <div className="info-note">{driverSafeNotesWithoutContacts(order.notes)}</div>}
          </div>
        )}
      </div>

      {/* Hârtiile către client, sub Fracht: acolo stă marfa, deci acolo se
          caută și actele ei. */}
      <TrimiteDocument order={order} lang={lang} />

      {isOwner && companyDrivers.length > 0 && !order.pickup_started_at && (
        <div className="reassign-footer">
          {!reassigning && !reassignTo ? (
            <button className="reassign-toggle" onClick={() => setReassignTo(' ')}>
              🔄 {t('reassignLabel', lang)}
            </button>
          ) : (
            <div className="reassign-open">
              <span>{t('reassignLabel', lang)}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="doc-type-select" value={reassignTo.trim()} onChange={(e) => setReassignTo(e.target.value)}>
                  <option value="">— {t('defaultDriverNone', lang)} —</option>
                  {companyDrivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}{d.plate ? ` · ${d.plate}` : ''}</option>
                  ))}
                </select>
                <button className="doc-add-btn btn secondary" disabled={!reassignTo.trim() || reassigning} onClick={reassignDriver}>
                  {reassigning ? '…' : t('reassignButton', lang)}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SignatureLine({ lang, signatureBlob, onChange }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="sig-line-toggle" onClick={() => setOpen(true)}>
        <span>✍️ {t('signatureLabel', lang)} <span className="sig-optional">({t('optionalLabel', lang)})</span></span>
        {signatureBlob ? <span className="sig-done">✓</span> : <span className="sig-chev">›</span>}
      </button>

      {open && (
        <div className="sig-fullscreen">
          <div className="sig-fullscreen-header">
            <span>{t('signatureLabel', lang)}</span>
            <button type="button" className="sig-fullscreen-close" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="sig-fullscreen-canvas">
            <SignaturePad onChange={onChange} />
          </div>
          <button type="button" className="btn" style={{ margin: 16 }} onClick={() => setOpen(false)}>
            {t('doneLabel', lang)}
          </button>
        </div>
      )}
    </>
  )
}

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const [hasDrawing, setHasDrawing] = useState(false)

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect()
    const point = e.touches ? e.touches[0] : e
    return { x: point.clientX - rect.left, y: point.clientY - rect.top }
  }

  function start(e) {
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const { x, y } = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(x, y)
    drawingRef.current = true
  }

  function move(e) {
    if (!drawingRef.current) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const { x, y } = getPos(e, canvas)
    ctx.lineTo(x, y)
    ctx.strokeStyle = '#0F2240'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.stroke()
    if (!hasDrawing) setHasDrawing(true)
  }

  function end() {
    drawingRef.current = false
    const canvas = canvasRef.current
    canvas.toBlob((blob) => onChange(blob), 'image/png')
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawing(false)
    onChange(null)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    canvas.getContext('2d').scale(ratio, ratio)
  }, [])

  return (
    <div className="sig-pad-wrap">
      <canvas
        ref={canvasRef}
        className="sig-pad-canvas"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={() => drawingRef.current && end()}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      {!hasDrawing && <div className="sig-pad-placeholder">{'✍'}</div>}
      {hasDrawing && (
        <button type="button" className="sig-pad-clear" onClick={clear}>✕</button>
      )}
    </div>
  )
}

function ElapsedTimer({ startedAt, compact }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0')
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  // Același cronometru, două mărimi. Clasa `timer` scrie cu 24px — bună
  // pentru o casetă lăţită, prea mare pentru un rând de butoane. Cifrele
  // rămân monospaţiate, altfel ceasul s-ar zbate la fiecare secundă.
  if (compact) {
    return (
      <span style={{
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 700,
        color: 'var(--navy, #0F2240)', letterSpacing: 0,
      }}>
        {hh === '00' ? '' : `${hh}:`}{mm}:{ss}
      </span>
    )
  }

  return <div className="timer">{hh}:{mm}:{ss}</div>
}

async function uploadPodFile(orderId, leg, file) {
  const ext = file.name.split('.').pop()
  const path = `${orderId}/${leg}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('proof-of-delivery').upload(path, file)
  if (error) throw error
  return path
}

function CelebrationScreen({ amount, lang, onClose }) {
  const [displayAmount, setDisplayAmount] = useState(0)

  useEffect(() => {
    // Blochează defilarea fundalului cât timp overlay-ul e vizibil.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [])

  useEffect(() => {
    if (amount == null) return
    const duration = 900
    const start = performance.now()
    let raf
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      // ease-out — pornește repede, încetinește spre final, senzație "premium"
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayAmount(amount * eased)
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [amount])

  return (
    <div className="celebration-overlay">
      <div className="celebration-card">
        <div className="celebration-check"><CheckCircle2 size={34} strokeWidth={2.2} /></div>
        <h2 className="celebration-title">{t('celebrationTitle', lang)}</h2>
        <p className="celebration-subtitle">{t('celebrationSubtitle', lang)}</p>
        <div className="celebration-trophy">
          <Trophy size={64} strokeWidth={1.4} />
        </div>
        {amount != null && (
          <>
            <div className="celebration-amount">+{displayAmount.toFixed(2)} €</div>
            <p className="celebration-earned">{t('celebrationEarned', lang)}</p>
          </>
        )}
        <button className="celebration-btn" onClick={onClose}>
          <ThumbsUp size={18} strokeWidth={2.2} /> {t('celebrationCta', lang)}
        </button>
      </div>
    </div>
  )
}

// Adăugarea unui document, în doi pași obligatorii: mai întâi tipul, apoi
// instrucțiunile de fotografiere pentru acel tip — pe tot ecranul, chiar
// înainte să se deschidă camera.
//
// Înainte exista un rând discret cu „💡 Tipp" care deschidea aceleași
// instrucțiuni. Nimeni nu-l apăsa, fiindcă apare exact în momentul în care
// șoferul e grăbit și vrea doar să pozeze. Acum instrucțiunile sunt pe drumul
// principal, nu pe o ramură laterală.
const DOC_TYPES = [
  { id: 'cmr', labelKey: 'docTypeCmr', guideKey: 'docGuideCmrText' },
  { id: 'zustellprotokoll', labelKey: 'docTypeProtocol', guideKey: 'docGuideProtocolText' },
  { id: 'other', labelKey: 'docTypeOther', guideKey: 'docGuideOtherText' },
]

function DocumentGuideIllustration() {
  return (
    <svg viewBox="0 0 280 200" style={{ width: '100%', maxWidth: 260 }}>
      <rect x="6" y="6" width="268" height="188" rx="12" fill="#F6F8FA" stroke="#E7EAF0" strokeWidth="2" />
      <rect x="58" y="26" width="164" height="148" rx="4" fill="#fff" stroke="#0F2240" strokeWidth="2.5" />
      <line x1="78" y1="50" x2="202" y2="50" stroke="#C7D0DE" strokeWidth="3" />
      <line x1="78" y1="70" x2="202" y2="70" stroke="#C7D0DE" strokeWidth="3" />
      <line x1="78" y1="90" x2="168" y2="90" stroke="#C7D0DE" strokeWidth="3" />
      <line x1="78" y1="130" x2="202" y2="130" stroke="#C7D0DE" strokeWidth="3" />
      <line x1="78" y1="150" x2="158" y2="150" stroke="#C7D0DE" strokeWidth="3" />
      <path d="M58 36 v-10 h10" fill="none" stroke="#FF7A29" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M222 36 v-10 h-10" fill="none" stroke="#FF7A29" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M58 164 v10 h10" fill="none" stroke="#FF7A29" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M222 164 v10 h-10" fill="none" stroke="#FF7A29" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}

function DocumentCapture({ lang, onPick, onClose }) {
  const [type, setType] = useState(null)
  const [review, setReview] = useState(null) // { file, url, checking, result }
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)

  const chosen = DOC_TYPES.find((d) => d.id === type)

  // Eliberăm previzualizarea când componenta dispare.
  useEffect(() => {
    return () => { if (review?.url) URL.revokeObjectURL(review.url) }
  }, [review?.url])

  const sheet = {
    background: '#fff', borderRadius: '16px 16px 0 0',
    padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
    maxHeight: '92vh', overflowY: 'auto',
  }
  const title = {
    fontFamily: "'Oswald', sans-serif", fontSize: 17, color: '#0F2240',
    textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 14,
  }

  // PDF-urile alese din galerie trec direct — nu au ce să fie verificate ca
  // fotografii. Pozele intră în pasul de verificare.
  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !type) return
    if (!String(file.type || '').startsWith('image/')) { onPick(file, type); return }

    setReview({ file, url: URL.createObjectURL(file), checking: true, result: null })
    const result = await analyzeDocumentPhoto(file)
    setReview((r) => (r && r.file === file ? { ...r, checking: false, result } : r))
  }

  function retake() {
    if (review?.url) URL.revokeObjectURL(review.url)
    setReview(null)
    cameraRef.current?.click()
  }

  return (
    <div className="sig-fullscreen" style={{ justifyContent: 'flex-end', background: 'rgba(15,34,64,.55)' }}>
      <div style={sheet}>
        {review ? (
          <>
            <div style={title}>{t(chosen ? chosen.labelKey : 'documentsLabel', lang)}</div>

            <div style={{
              borderRadius: 10, overflow: 'hidden', marginBottom: 12,
              border: `2px solid ${review.checking ? '#D8DEE8' : review.result?.ok ? '#1F7A50' : '#B23A24'}`,
              background: '#0F2240',
            }}>
              <img src={review.url} alt="" style={{ width: '100%', display: 'block', maxHeight: '46vh', objectFit: 'contain' }} />
            </div>

            {review.checking ? (
              <div style={{ fontSize: 13.5, color: '#6B7A90', marginBottom: 14 }}>{t('qChecking', lang)}</div>
            ) : review.result?.ok ? (
              <div style={{
                background: '#EAF5EF', border: '1px solid #A8D5BE', borderRadius: 10,
                padding: '11px 13px', fontSize: 13.5, color: '#1F7A50', marginBottom: 14,
              }}>
                ✓ {t('qGood', lang)}
              </div>
            ) : (
              <div style={{
                background: '#FCEBE8', border: '1px solid #E4A296', borderRadius: 10,
                padding: '11px 13px', fontSize: 13.5, color: '#B23A24', marginBottom: 14,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('qProblemTitle', lang)}</div>
                {review.result.issues.map((k) => (
                  <div key={k}>· {t(k, lang)}</div>
                ))}
              </div>
            )}

            {!review.checking && (
              <>
                <button
                  type="button"
                  className={review.result?.ok ? 'btn secondary' : 'btn'}
                  style={{ width: '100%', marginTop: 0 }}
                  onClick={retake}
                >
                  {t('qRetake', lang)}
                </button>
                <button
                  type="button"
                  className={review.result?.ok ? 'btn' : 'btn secondary'}
                  style={{ width: '100%', marginTop: 10 }}
                  onClick={() => onPick(review.file, type)}
                >
                  {review.result?.ok ? t('qUse', lang) : t('qUseAnyway', lang)}
                </button>
              </>
            )}
          </>
        ) : !chosen ? (
          <>
            <div style={title}>{t('docChooseType', lang)}</div>
            {DOC_TYPES.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setType(d.id)}
                style={{
                  width: '100%', textAlign: 'left', background: '#fff',
                  border: '1px solid #D8DEE8', borderRadius: 10,
                  padding: '15px 16px', fontSize: 15, fontWeight: 600,
                  color: '#0F2240', marginBottom: 10, cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                {t(d.labelKey, lang)}
                <span style={{ color: '#B9C3D1' }}>›</span>
              </button>
            ))}
            <button type="button" className="link-btn" onClick={onClose}>{t('back', lang)}</button>
          </>
        ) : (
          <>
            <div style={title}>{t(chosen.labelKey, lang)}</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <DocumentGuideIllustration />
            </div>
            <p style={{ fontSize: 13.5, color: '#0F2240', lineHeight: 1.55, margin: '0 0 14px' }}>
              {t(chosen.guideKey, lang)}
            </p>
            <ul style={{ margin: '0 0 18px', paddingLeft: 18, fontSize: 13, color: '#6B7A90', lineHeight: 1.7 }}>
              <li>{t('docRuleCorners', lang)}</li>
              <li>{t('docRuleFlat', lang)}</li>
              <li>{t('docRuleLight', lang)}</li>
              <li>{t('docRuleReadable', lang)}</li>
            </ul>

            <button type="button" className="btn" style={{ width: '100%', marginTop: 0 }} onClick={() => cameraRef.current?.click()}>
              {t('docOpenCamera', lang)}
            </button>
            <button type="button" className="btn secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => galleryRef.current?.click()}>
              {t('docFromGallery', lang)}
            </button>
            <button type="button" className="link-btn" onClick={() => setType(null)} style={{ marginTop: 8 }}>
              {t('back', lang)}
            </button>

            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFile} />
            <input ref={galleryRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleFile} />
          </>
        )}
      </div>
    </div>
  )
}

// Problemele pe care șoferul le poate raporta din teren.
//
// Ordinea contează: primele sunt cele care apar zilnic. Un șofer grăbit,
// afară, cu mănuși, nu derulează o listă de unsprezece opțiuni ca să
// găsească „Empfänger nicht vor Ort".
const INCIDENT_KINDS = [
  'empfaenger_nicht_vor_ort',
  'empfaenger_nicht_erreichbar',
  'annahme_verweigert',
  'wartezeit',
  'adresse_nicht_gefunden',
  'adresse_falsch',
  'zufahrt_nicht_moeglich',
  'keine_entladehilfe',
  'ware_beschaedigt',
  'dokument_fehlt',
  'sonstiges',
]

// Raportarea unei probleme.
//
// Comanda NU se închide și NU se marchează ca livrată. Rămâne în lucru, iar
// dispecerul decide ce urmează — exact ca la telefon, doar că rămâne scris,
// cu oră, poziție și fotografie.
function IncidentSheet({ order, leg, lang, driverId, blocking, onClose, onSaved }) {
  // La „livrarea nu e posibilă" categoria e deja evidentă din context; șoferul
  // alege doar motivul concret.
  const [kind, setKind] = useState(null)
  const [comment, setComment] = useState('')
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    return () => { photos.forEach((p) => p.url && URL.revokeObjectURL(p.url)) }
  }, [photos])

  function addPhotos(e) {
    const files = Array.from(e.target.files || []).slice(0, 3 - photos.length)
    e.target.value = ''
    setPhotos((prev) => [...prev, ...files.map((f) => ({ file: f, url: URL.createObjectURL(f) }))])
  }

  async function save() {
    if (!kind) return
    setBusy(true)
    setError('')

    // Poziția e utilă dispecerului („zice că nu găsește adresa, dar e la 8 km
    // de ea"), dar nu blocăm raportul dacă telefonul refuză s-o dea.
    const position = await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null)
      const timer = setTimeout(() => resolve(null), 4000)
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }) },
        () => { clearTimeout(timer); resolve(null) },
        { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
      )
    })

    // Fotografiile sunt un plus, nu o condiție. Dacă încărcarea eșuează,
    // raportul pleacă oricum — un incident nesalvat e mai rău decât unul
    // fără poză.
    const paths = []
    for (const p of photos) {
      try {
        const { blob, mime } = await processImage(p.file, PHOTO_PRESET)
        const path = `${order.id}/incident/${crypto.randomUUID?.() || Date.now()}.jpg`
        const { error: upErr } = await supabase.storage
          .from('proof-of-delivery')
          .upload(path, blob, { contentType: mime, upsert: true })
        if (!upErr) paths.push(path)
      } catch (err) {
        console.error('incident photo failed:', err.message)
      }
    }

    const { error: insErr } = await supabase.from('order_incidents').insert({
      order_id: order.id,
      driver_id: driverId || null,
      leg,
      kind,
      comment: comment.trim() || null,
      photos: paths.length ? paths : null,
      lat: position?.lat ?? null,
      lng: position?.lng ?? null,
      // Raportul de „livrare imposibilă" blochează confirmarea până când
      // dispecerul decide. Celelalte probleme se raportează fără să oprească
      // nimic — șoferul poate continua dacă situația se rezolvă singură.
      blocks_delivery: !!blocking,
    })

    setBusy(false)
    if (insErr) {
      console.error('incident insert error:', insErr.message)
      setError(t('incidentFailed', lang))
      return
    }
    onSaved()
  }

  const sheet = {
    background: '#fff', borderRadius: '16px 16px 0 0',
    padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
    maxHeight: '92vh', overflowY: 'auto',
  }

  return (
    <div className="sig-fullscreen" style={{ justifyContent: 'flex-end', background: 'rgba(15,34,64,.55)' }}>
      <div style={sheet}>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 17, color: '#0F2240', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 4 }}>
          {t('incidentTitle', lang)}
        </div>
        <p style={{ fontSize: 12.5, color: '#6B7A90', margin: '0 0 16px', lineHeight: 1.5 }}>
          {t('incidentSubtitle', lang)}
        </p>

        {!kind ? (
          <>
            {INCIDENT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                style={{
                  width: '100%', textAlign: 'left', background: '#fff',
                  border: '1px solid #D8DEE8', borderRadius: 10,
                  padding: '13px 15px', fontSize: 14.5, fontWeight: 600,
                  color: '#0F2240', marginBottom: 8, cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                {t(`incident_${k}`, lang)}
                <span style={{ color: '#B9C3D1' }}>›</span>
              </button>
            ))}
            <button type="button" className="link-btn" onClick={onClose}>{t('back', lang)}</button>
          </>
        ) : (
          <>
            <div style={{
              background: '#FFF6ED', border: '1px solid #FFD2AE', borderRadius: 10,
              padding: '11px 13px', fontSize: 14, fontWeight: 700, color: '#B35A12', marginBottom: 14,
            }}>
              {t(`incident_${kind}`, lang)}
            </div>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('incidentCommentPlaceholder', lang)}
              rows={4}
              style={{ width: '100%', padding: '11px 12px', fontSize: 16, border: '1px solid #D8DEE8', borderRadius: 8, marginBottom: 12, resize: 'vertical' }}
            />

            <div className="photo-grid" style={{ marginBottom: 14 }}>
              {photos.map((p, i) => (
                <div className="photo-slot filled" key={i} onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>
                  <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
              {photos.length < 3 && (
                <div className="photo-slot" onClick={() => fileRef.current?.click()}>+</div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={addPhotos} />

            {error && (
              <div style={{ background: '#FCEBE8', border: '1px solid #E4A296', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#B23A24', marginBottom: 12 }}>
                {error}
              </div>
            )}

            <button className="btn" style={{ width: '100%', marginTop: 0 }} onClick={save} disabled={busy}>
              {busy ? t('incidentSending', lang) : t('incidentSend', lang)}
            </button>
            <button type="button" className="link-btn" onClick={() => setKind(null)} style={{ marginTop: 8 }}>
              {t('back', lang)}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Notificarea de ETA către client. Intervalul e ales de șofer, nu calculat
// din Google Directions — un apel de rute la fiecare deschidere ar readuce
// exact problema de consum pe care încercăm s-o reducem. Prepopulăm din
// fereastra programată a comenzii, iar șoferul ajustează.
function EtaSheet({ order, leg, entry, lang, driverPhone, onClose, onSent }) {
  // La o oprire de tur, intervalul programat, numărătoarea şi textul vin din
  // rândul opririi, nu din coloanele comenzii. `leg` e acolo id-ul opririi,
  // deci comparaţiile cu 'pickup' nu mai spun nimic despre felul etapei.
  const oprire = entry?.stop || null
  const esteLivrareEta = entry ? entry.kind === 'delivery' : leg === 'delivery'
  // La oră fixă, intervalul programat e un singur ceas. Îl luăm ca început şi
  // punem o jumătate de oră după el: şoferul anunţă oricum un interval, iar
  // fără capătul de sus câmpul s-ar fi umplut cu „acum + 90 de minute", care
  // la o oprire de la 14:00 putea ieşi ÎNAINTEA începutului şi refuza
  // trimiterea cu „interval greşit".
  const plusJumatateDeOra = (hhmm) => {
    const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null
    const tot = (h * 60 + m + 30) % (24 * 60)
    return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`
  }
  const oraFixa = oprire ? (oprire.time_fixed ? oprire.time_at : null) : null
  const scheduledFrom = oprire
    ? (oraFixa || oprire.time_from)
    : (esteLivrareEta ? (order.delivery_time || order.delivery_from) : (order.pickup_time || order.pickup_from))
  const scheduledTo = oprire
    ? (oraFixa ? plusJumatateDeOra(oraFixa) : oprire.time_to)
    : (esteLivrareEta ? order.delivery_to : order.pickup_to)

  function plusMinutes(min) {
    const d = new Date(Date.now() + min * 60000)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  function todayIso() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const [date, setDate] = useState(todayIso())
  const [from, setFrom] = useState(() => (scheduledFrom ? String(scheduledFrom).slice(0, 5) : plusMinutes(30)))
  const [to, setTo] = useState(() => (scheduledTo ? String(scheduledTo).slice(0, 5) : plusMinutes(90)))
  const [sharePhone, setSharePhone] = useState(false)   // implicit OPRIT
  const [phone, setPhone] = useState(driverPhone || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const sentCount = oprire
    ? (oprire.eta_count || 0)
    : (esteLivrareEta ? (order.delivery_eta_count || 0) : (order.pickup_eta_count || 0))

  async function send() {
    setError('')
    if (!date || !from || !to || to <= from) {
      setError(t('etaBadWindow', lang))
      return
    }
    setBusy(true)
    const { data, error: rpcErr } = await supabase.rpc('driver_send_eta', {
      p_order_id: order.id,
      p_leg: leg,
      p_from: new Date(`${date}T${from}:00`).toISOString(),
      p_to: new Date(`${date}T${to}:00`).toISOString(),
      p_phone: sharePhone ? (phone.trim() || null) : null,
    })
    setBusy(false)
    if (rpcErr) {
      console.error('driver_send_eta:', rpcErr.message)
      setError(t('etaFailed', lang))
      return
    }
    if (!data?.ok) {
      const reasons = {
        no_recipient: 'etaNoRecipient',
        limit_reached: 'etaLimitReached',
        bad_window: 'etaBadWindow',
        not_assigned: 'etaFailed',
        bad_leg: 'etaFailed',
        already_done: 'etaAlreadyDone',
      }
      setError(t(reasons[data?.reason] || 'etaFailed', lang))
      return
    }
    onSent(data.count)
  }

  const label = { display: 'block', fontSize: 12, fontWeight: 700, color: '#6B7A90', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.03em' }
  const field = { width: '100%', padding: '11px 12px', fontSize: 16, border: '1px solid #D8DEE8', borderRadius: 8, background: '#fff', color: '#0F2240' }

  return (
    <div className="sig-fullscreen" style={{ justifyContent: 'flex-end', background: 'rgba(15,34,64,.55)' }}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '20px 20px calc(20px + env(safe-area-inset-bottom))', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 17, color: '#0F2240', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.03em' }}>
          {t('etaTitle', lang)}
        </div>
        <p style={{ fontSize: 12.5, color: '#6B7A90', margin: '0 0 16px', lineHeight: 1.5 }}>
          {t(esteLivrareEta ? 'etaSubtitleDelivery' : 'etaSubtitlePickup', lang)}
          {oprire && (
            <><br /><strong style={{ color: '#0F2240' }}>{oprire.company || oprire.address}</strong></>
          )}
        </p>

        <label style={label}>{t('etaDateLabel', lang)}</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...field, marginBottom: 14 }} />

        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>{t('etaFromLabel', lang)}</label>
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} style={field} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>{t('etaToLabel', lang)}</label>
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)} style={field} />
          </div>
        </div>

        <div style={{ background: '#F6F8FA', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={sharePhone}
              onChange={(e) => setSharePhone(e.target.checked)}
              style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0 }}
            />
            <span style={{ fontSize: 13.5, color: '#0F2240', lineHeight: 1.45 }}>
              {t('etaSharePhone', lang)}
              <span style={{ display: 'block', fontSize: 12, color: '#6B7A90', marginTop: 2 }}>
                {t('etaSharePhoneNote', lang)}
              </span>
            </span>
          </label>
          {sharePhone && (
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('etaPhonePlaceholder', lang)}
              style={{ ...field, marginTop: 10 }}
            />
          )}
        </div>

        {error && (
          <div style={{ background: '#FCEBE8', border: '1px solid #E4A296', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#B23A24', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {sentCount > 0 && (
          <div style={{ fontSize: 12, color: '#6B7A90', marginBottom: 10 }}>
            {t('etaAlreadySent', lang).replace('{n}', sentCount)}
          </div>
        )}

        <button className="btn" onClick={send} disabled={busy} style={{ width: '100%' }}>
          {busy ? '…' : t('etaSendButton', lang)}
        </button>
        <button type="button" className="link-btn" onClick={onClose} style={{ marginTop: 8 }}>
          {t('back', lang)}
        </button>
      </div>
    </div>
  )
}

// Fereastra în care șoferul își poate corecta singur o apăsare greșită.
// 30 de secunde: destul cât să observe, prea puțin cât să rescrie istoricul.
const UNDO_WINDOW_MS = 30000

function UndoBar({ field, at, lang, onUndo }) {
  const [left, setLeft] = useState(() => Math.max(0, UNDO_WINDOW_MS - (Date.now() - at)))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      setLeft(Math.max(0, UNDO_WINDOW_MS - (Date.now() - at)))
    }, 500)
    return () => clearInterval(id)
  }, [at])

  if (left <= 0) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      background: '#FFF6ED', border: '1px solid #FFD2AE', borderRadius: 10,
      padding: '10px 12px', marginBottom: 10, fontSize: 13, color: '#B35A12',
    }}>
      <span>{t('undoHint', lang)}</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => { setBusy(true); await onUndo(field); setBusy(false) }}
        style={{
          background: '#fff', border: '1px solid #FF7A29', color: '#E8631A',
          borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 700,
          whiteSpace: 'nowrap', cursor: 'pointer',
        }}
      >
        {busy ? '…' : `${t('undoLabel', lang)} (${Math.ceil(left / 1000)})`}
      </button>
    </div>
  )
}

// ——— Hârtiile către client, din bara de sus ———
//
// Cazul real: șoferul ajunge la încărcare și expeditorul nu are hârtiile
// tipărite. Butonul stătea în pasul cu pozele, deci exista numai după
// "Angekommen" — iar înghesuia tocmai ecranul în care șoferul lucrează. Acum
// stă sus, pe linia cu "Zurück", și se poate apăsa oricând.
//
// La comenzile de documente confidenţiale pleacă Zustellprotokoll-ul ȘI
// Botenbestătigung-ul; la marfă, CMR-ul. Alegerea o face serverul, după
// comandă — aici doar se scrie pe buton care dintre ele e.
function mascheazaEmail(x) {
  const s = String(x || '').trim()
  const i = s.indexOf('@')
  if (i < 1) return s ? '\u2022\u2022\u2022' : ''
  const scurt = (v, n) => v.slice(0, n) + '\u2022'.repeat(Math.max(2, Math.min(6, v.length - n)))
  const domeniu = s.slice(i + 1)
  const punct = domeniu.lastIndexOf('.')
  const nume = punct > 0 ? domeniu.slice(0, punct) : domeniu
  const tld = punct > 0 ? domeniu.slice(punct) : ''
  return `${scurt(s.slice(0, i), 1)}@${scurt(nume, 1)}${tld}`
}

function TrimiteDocument({ order, lang }) {
  const [deschis, setDeschis] = useState(false)
  // Adresa clientului nu se arată întreagă: șoferul duce plicul, nu are
  // nevoie să știe cu cine lucrează firma. Dar o poate înlocui, căci la
  // ridicare poate fi altcineva care primește hârtia.
  const [adresa, setAdresa] = useState('')
  const [alta, setAlta] = useState(null)
  const [stare, setStare] = useState(null)

  const esteDoc = !!order?.is_document_delivery
  const eticheta = esteDoc ? t('docBtnDocs', lang) : t('docBtnCmr', lang)
  const titlu = esteDoc ? t('docSheetTitleDocs', lang) : t('docSheetTitleCmr', lang)
  const inEditare = alta != null || !adresa
  const destinatar = (alta == null ? adresa : alta).trim()
  const poateTrimite = destinatar.includes('@') && destinatar.includes('.')

  async function deschide() {
    setDeschis(true)
    setStare(null)
    if (!adresa) {
      const { data } = await supabase.rpc('driver_get_order_contact_email', { p_order_id: order.id })
      if (data) setAdresa(String(data))
    }
  }

  async function trimite() {
    setStare({ busy: true })
    try {
      const { data, error } = await supabase.functions.invoke('send-order-document', {
        body: { orderId: order.id, email: destinatar },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setStare({ ok: true, msg: t('docSentOk', lang).replace('{d}', data?.document || '') })
    } catch (e) {
      setStare({ ok: false, msg: e.message || String(e) })
    }
  }

  return (
    <>
      {/* Aceeași clasă ca butonul „Zurück“, deci aceeași înălţime și același
          fel de apăsare. Un alt desen pe același rând arăta ca o greșeală. */}
      {/* Un bloc pe toată lăţimea, nu o pastilă înghesuită sus.
          Pe un rând cu „Zurück“ și ceasul, eticheta întreagă nu încape pe un
          telefon de 360 de punăţi — măsurat: 337 de puncte pe 320. Aici încape,
          și mai încape și rândul care spune LA CE e bun butonul. */}
      <button
        type="button"
        onClick={deschide}
        style={{
          display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
          background: '#fff', border: '1px solid var(--line, #D8DEE8)', borderRadius: 12,
          padding: '12px 14px', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 20, flexShrink: 0 }}>📄</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: '#0F2240' }}>
            {eticheta}
          </span>
          <span style={{ display: 'block', fontSize: 12, color: '#6B7A90', marginTop: 2, lineHeight: 1.45 }}>
            {t('docBtnNote', lang)}
          </span>
        </span>
      </button>

      {deschis && (
        <div className="sig-fullscreen" style={{ justifyContent: 'flex-end', background: 'rgba(15,34,64,.55)' }}>
          <div style={{
            background: '#fff', borderRadius: '16px 16px 0 0',
            padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
            maxHeight: '92vh', overflowY: 'auto',
          }}>
            <div style={{
              fontFamily: "'Oswald', sans-serif", fontSize: 17, color: '#0F2240',
              textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 4,
            }}>
              {titlu}
            </div>
            <p style={{ fontSize: 12.5, color: '#6B7A90', margin: '0 0 10px', lineHeight: 1.5 }}>
              {t('docSheetHint', lang)}
            </p>
            {/* Cazul pentru care există butonul: la rampă nu e tipărit nimic.
                Telefonul se dă omului de acolo, el își scrie adresa și hârtia
                îi vine în clipă — fără telefon la dispecerat și fără ca șoferul
                să ghicească o adresă dictată pe jumătate. */}
            <div style={{
              background: '#F3FBF6', border: '1px solid #BFE8CF', borderRadius: 9,
              padding: '9px 11px', fontSize: 12.5, color: '#1B6E43', lineHeight: 1.5,
              margin: '0 0 14px',
            }}>
              {t('docSheetHandover', lang)}
            </div>

            {!inEditare ? (
              <>
                <div style={{
                  fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '.04em', color: '#6B7A90', marginBottom: 5,
                }}>
                  {t('docEmailHidden', lang)}
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  border: '1px solid #D8DEE8', borderRadius: 9, padding: '11px 12px',
                  background: '#F6F8FA',
                }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 14.5, color: '#0F2240', letterSpacing: '.02em' }}>
                    {mascheazaEmail(adresa)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAlta('')}
                    style={{
                      background: 'transparent', border: '1px solid #D8DEE8', borderRadius: 14,
                      padding: '4px 11px', fontSize: 12, fontWeight: 700, color: '#6B7A90',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {t('docEmailChange', lang)}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="pod-label">{t('docEmailOther', lang)}</div>
                <input
                  className="bid-input2"
                  type="email"
                  inputMode="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={alta || ''}
                  onChange={(e) => setAlta(e.target.value)}
                  placeholder="name@firma.de"
                  style={{ width: '100%', margin: '0 0 6px' }}
                />
                {adresa ? (
                  <button type="button" className="link-btn" onClick={() => setAlta(null)}>
                    {t('docEmailBack', lang)}
                  </button>
                ) : null}
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                className="btn"
                style={{ flex: 1 }}
                onClick={trimite}
                disabled={stare?.busy || !poateTrimite}
              >
                {stare?.busy ? '\u2026' : t('sendDocAction', lang)}
              </button>
              <button
                type="button"
                onClick={() => { setDeschis(false); setStare(null) }}
                style={{
                  background: 'transparent', border: '1px solid #D8DEE8', borderRadius: 9,
                  padding: '0 16px', fontSize: 13.5, color: '#6B7A90', cursor: 'pointer',
                }}
              >
                {t('cancel', lang)}
              </button>
            </div>

            {stare && !stare.busy && (
              <div style={{ fontSize: 12.5, marginTop: 9, lineHeight: 1.5, color: stare.ok ? '#1B6E43' : '#B23A24' }}>
                {stare.ok ? '\u2713 ' : '\u26a0 '}{stare.msg}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ——— Celălalt capăt al cursei, chiar în pasul cu pozele ———
//
// Șoferul stă la rampă cu telefonul într-o mână: știe unde e, dar nu știe
// pentru cine încarcă. Iar la a șaptea livrare din zi nu mai ţine minte de la
// cine a ridicat — exact ce-l întreabă destinatarul. Datele erau deja în
// comandă, numai că rămâneau sus, în cardul de detalii: trebuia ieșit din pasul
// cu pozele, pe lângă butoanele care confirmă. Aici nu se confirmă nimic.
//
// Contactele stau în `notes`, scrise de pipeline la fel de fiecare dată
// ("Kontakt Abholung: Nume (Firmă) · Tel. …"), iar opririle le au pe coloane
// proprii. Funcţia citește din ambele și dă o listă cu același format.
function capeteCursa(order, spreLivrare) {
  const opriri = tourStops(order)
  const dinOprire = (s) => ({
    address: s.address || null,
    contact: ([s.company, s.contact_name].filter(Boolean).join(' \u00b7 ')
      + (s.contact_phone ? ` \u00b7 Tel. ${s.contact_phone}` : '')).trim() || null,
    note: s.note || null,
    reference: s.reference || null,
    cargo: s.cargo_desc || null,
    quantity: null,
    weight: s.cargo_weight_kg || null,
    date: s.stop_date || null,
    timeFixed: !!s.time_fixed,
    timeAt: s.time_at || null,
    timeFrom: s.time_from || null,
    timeTo: s.time_to || null,
  })
  const dinComanda = (k, prefixContact, prefixNota) => ({
    address: order?.[LEG_ADDRESS_FIELD[k]] || null,
    contact: extractContact(order?.notes, prefixContact),
    note: extractContact(order?.notes, prefixNota),
    reference: order?.reference || null,
    cargo: order?.cargo_desc || null,
    quantity: order?.quantity || null,
    weight: order?.weight || null,
    date: order?.[`${k}_date`] || null,
    timeFixed: !!order?.[`${k}_fixed`],
    timeAt: order?.[`${k}_time`] || null,
    timeFrom: order?.[`${k}_from`] || null,
    timeTo: order?.[`${k}_to`] || null,
  })
  const lista = spreLivrare
    ? [
        ...opriri.filter((s) => s.kind === 'delivery').map(dinOprire),
        dinComanda('delivery', 'Kontakt Zustellung: ', 'Notiz Zustellung: '),
      ]
    : [
        dinComanda('pickup', 'Kontakt Abholung: ', 'Notiz Abholung: '),
        ...opriri.filter((s) => s.kind !== 'delivery').map(dinOprire),
      ]
  // Returul n-are coloane proprii de contact — adresa și fereastra de timp
  // sunt tot ce există în bază, deci atât se arată.
  if (order?.is_round_trip) {
    const k = spreLivrare ? 'return_delivery' : 'return_pickup'
    const adresa = order?.[LEG_ADDRESS_FIELD[k]]
    if (adresa) {
      lista.push({
        address: adresa, contact: null, note: null,
        reference: order?.reference || null,
        cargo: order?.return_cargo_desc || null, quantity: null, weight: null,
        date: order?.[`${k}_date`] || null,
        timeFixed: false, timeAt: null,
        timeFrom: order?.[`${k}_from`] || null, timeTo: order?.[`${k}_to`] || null,
      })
    }
  }
  return lista.filter((x) => x.address || x.contact)
}

function AltCapat({ order, lang, spreLivrare }) {
  const [deschis, setDeschis] = useState(false)
  const lista = capeteCursa(order, spreLivrare)
  if (!lista.length) return null
  const titluButon = spreLivrare ? t('otherEndDeliveryBtn', lang) : t('otherEndPickupBtn', lang)
  const titluPanou = spreLivrare ? t('otherEndDeliveryTitle', lang) : t('otherEndPickupTitle', lang)
  const semn = spreLivrare ? '\ud83c\udd51' : '\ud83c\udd50'
  const multiple = lista.length > 1
  return (
    <>
      {/* Punctat și fără culoare: nu seamănă cu niciun buton care confirmă,
          deci nu se apasă din greșeală cu telefonul într-o mână. */}
      <button
        type="button"
        onClick={() => setDeschis(true)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          width: '100%', margin: '0 0 12px', padding: '10px 12px',
          background: 'transparent', border: '1px dashed var(--border, #C8D2E0)',
          borderRadius: 9, color: 'var(--text-soft, #6B7A90)',
          fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
        }}
      >
        {semn} {titluButon}
      </button>

      {deschis && (
        <div
          style={{
            position: 'fixed', inset: 0, background: '#fff', zIndex: 9999, overflowY: 'auto',
            paddingTop: 'calc(22px + env(safe-area-inset-top, 0px))',
            paddingBottom: 'calc(22px + env(safe-area-inset-bottom, 0px))',
            paddingLeft: 18, paddingRight: 18,
          }}
        >
          <div style={{ maxWidth: 440, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: '#0F2240', lineHeight: 1.3 }}>
                {semn} {titluPanou}
              </div>
              <button
                type="button"
                onClick={() => setDeschis(false)}
                aria-label={t('back', lang)}
                style={{ background: 'transparent', border: 0, fontSize: 26, lineHeight: 1, color: '#6B7A90', cursor: 'pointer', padding: '0 2px' }}
              >
                {'×'}
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#6B7A90', margin: '4px 0 16px', lineHeight: 1.5 }}>
              {order?.order_number ? `${order.order_number} \u00b7 ` : ''}{t('otherEndInfoOnly', lang)}
            </div>

            {lista.map((c, i) => {
              const interval = c.timeFixed
                ? (c.timeAt ? fmtTime(c.timeAt) : '')
                : [c.timeFrom, c.timeTo].filter(Boolean).map((x) => fmtTime(x)).join('\u2013')
              const telefon = extractPhone(c.contact)
              const marfa = [
                c.quantity ? `${c.quantity}\u00d7` : null,
                c.cargo || null,
                c.weight ? `${c.weight} kg` : null,
              ].filter(Boolean).join(' \u00b7 ')
              return (
                <div key={i} style={{ border: '1px solid #E2E7EE', borderRadius: 10, padding: '12px 13px', marginBottom: 10 }}>
                  {multiple && (
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6B7A90', marginBottom: 6 }}>
                      {spreLivrare ? t('delivery', lang) : t('pickup', lang)} {i + 1} / {lista.length}
                    </div>
                  )}
                  {c.contact && (
                    <div style={{ fontSize: 15.5, fontWeight: 800, color: '#0F2240', lineHeight: 1.4 }}>
                      {c.contact.split(' \u00b7 Tel.')[0].trim()}
                    </div>
                  )}
                  {c.address && (
                    <div style={{ fontSize: 14, color: '#0F2240', marginTop: 3, lineHeight: 1.5 }}>{c.address}</div>
                  )}
                  {(c.date || interval) && (
                    <div style={{ fontSize: 13, color: '#6B7A90', marginTop: 5 }}>
                      {c.date ? fmtDate(c.date) : ''}
                      {c.date && interval ? ' \u00b7 ' : ''}
                      {interval ? (c.timeFixed ? `\ud83d\udd12 ${interval}` : interval) : ''}
                    </div>
                  )}
                  {telefon && (
                    <a
                      href={`tel:${telefon.replace(/[^\d+]/g, '')}`}
                      style={{
                        display: 'inline-block', marginTop: 9, fontSize: 14, fontWeight: 700,
                        color: '#0F2240', textDecoration: 'none',
                        border: '1px solid #D8DEE8', borderRadius: 8, padding: '7px 11px',
                      }}
                    >
                      {'📞'} {telefon}
                    </a>
                  )}
                  {c.reference && (
                    <div style={{ fontSize: 13, color: '#0F2240', marginTop: 9 }}>
                      <strong>{t('referenceLabel', lang)}:</strong> {c.reference}
                    </div>
                  )}
                  {marfa && (
                    <div style={{ fontSize: 13, color: '#0F2240', marginTop: 4 }}>
                      <strong>{t('cargoLabel', lang)}:</strong> {marfa}
                    </div>
                  )}
                  {c.note && (
                    <div style={{
                      background: '#FFF6ED', border: '1px solid #FFD2AE', borderRadius: 8,
                      padding: '8px 10px', fontSize: 13, color: '#8A5A16', lineHeight: 1.5, marginTop: 9,
                    }}>
                      {c.note}
                    </div>
                  )}
                </div>
              )
            })}

            <button type="button" className="btn" style={{ width: '100%', marginTop: 4 }} onClick={() => setDeschis(false)}>
              {t('back', lang)}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function LegWorkflow({ order, leg, legEntry, lang, startedAt, arrivedAt, onStatusChange, isOwner, onDeliveryComplete, profile, onStopFailed }) {
  const [busy, setBusy] = useState(false)
  const [fileSummary, setFileSummary] = useState({ total: 0, allDone: false, failed: 0, pending: 0, processing: 0, photoCount: 0, documentCount: 0 })
  const [signatureBlob, setSignatureBlob] = useState(null)
  const [signerName, setSignerName] = useState('')
  // Doar la Dokumentenzustellung: cum a fost predat documentul.
  const [deliveryMethod, setDeliveryMethod] = useState(order.delivery_method || null)
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const [photoSourceOpen, setPhotoSourceOpen] = useState(false)

  // Etapa, ca obiect. La o oprire de tur vine din `trip_stops`; la capetele
  // cursei, din coloanele comenzii. Tot ce urmează citeşte de aici, deci nu
  // mai trebuie să ştie unde stau datele.
  const intrare = legEntry || { key: leg, kind: (leg === 'delivery' || leg === 'return_delivery') ? 'delivery' : 'pickup', stop: null }
  const fapte = legFacts(order, intrare)
  const esteOprire = !!intrare.stop
  const esteLivrareEtapa = intrare.kind === 'delivery'

  // Numele funcţiilor de pe server, derivate din etapă — nu enumerate.
  const rpc = legRpcNames(intrare)
  const startFn = rpc.start
  const arriveFn = rpc.arrive
  const confirmFn = rpc.confirm

  // Numele câmpului pe care-l marcăm local, imediat după ce butonul reuşeşte.
  // La o oprire câmpurile sunt simple (`arrived_at`); la capetele cursei
  // purtă prefixul etapei (`pickup_arrived_at`).
  const campEtapa = (pas) => (esteOprire ? `${pas}_at` : `${intrare.key}_${pas}_at`)

  // Turul nu se încheie cu opriri fără dovadă. Baza de date refuză oricum
  // (există un declanşator), dar aici îi spunem şoferului CÂTE lipsesc, în loc
  // să-i arate o eroare de server la ultima apăsare.
  const opririDeschise = tourStops(order).filter(
    (st) => !st.confirmed_at && !st.failed_at && st.id !== intrare.key,
  ).length
  const esteUltimaEtapa = (() => {
    const q = tourLegSequence(order)
    return q.length > 0 && q[q.length - 1].key === intrare.key
  })()
  const turIncomplet = esteUltimaEtapa && opririDeschise > 0

  const numar = legCounter(order, intrare)
  const legLabel = [
    esteLivrareEtapa ? t('delivery', lang) : t('pickup', lang),
    numar ? `${numar.n} / ${numar.total}` : null,
  ].filter(Boolean).join(' ')

  // Ultima etapă marcată, cât timp mai poate fi anulată.
  const [undoable, setUndoable] = useState(null) // { field, at } | null

  async function undoStage(field) {
    const { data, error } = esteOprire
      ? await supabase.rpc('driver_undo_stop_stage', { p_stop_id: intrare.stop.id, p_field: field })
      : await supabase.rpc('driver_undo_stage', { p_order_id: order.id, p_field: field })
    if (error) {
      console.error('undo error:', error.message)
      setUndoError(t('undoFailed', lang))
      return
    }
    if (data !== true) {
      // Fereastra a expirat sau etapa următoare a fost deja marcată.
      setUndoError(t('undoTooLate', lang))
      setUndoable(null)
      return
    }
    setUndoable(null)
    setUndoError('')
    onStatusChange(field, null)
  }

  const [undoError, setUndoError] = useState('')

  async function callRpc(fn) {
    if (busy) return
    setBusy(true)
    // La o oprire se trimite `p_stop_id`; la capetele cursei, `p_order_id`.
    const { error } = await supabase.rpc(fn, esteOprire ? rpc.args : { p_order_id: order.id })
    setBusy(false)
    if (error) {
      console.error(fn, error.message)
      return
    }
    // La plecarea spre livrarea de documente, o notă scurtă care dispare
    // singură: şoferul o citeşte în timp ce porneşte, nu trebuie să apese.
    if (esteEtapaLivrareDoc && /_started$/.test(fn)) {
      setNotitaPlecare(true)
      setTimeout(() => setNotitaPlecare(false), 5000)
    }
    // Marcăm local, instant, fără să aşteptăm sincronizarea live din bază.
    const pas = /_started$/.test(fn) ? 'started' : /_arrived$/.test(fn) ? 'arrived' : null
    if (pas) {
      const field = campEtapa(pas)
      onStatusChange(field)
      setUndoable({ field, at: Date.now() })
    }
  }

  // ETA e disponibil doar pe traseul principal. Cursele de retur ar avea
  // nevoie de propriile coloane; până atunci butonul nu apare acolo, ca să nu
  // suprascrie intervalul anunțat pentru dus.
  // Incidentul care blochează livrarea, dacă există unul nerezolvat.
  //
  // Cât timp e deschis, șoferul nu poate confirma livrarea: decizia o ia
  // dispecerul, după ce vorbește cu clientul. Când dispecerul îl marchează
  // rezolvat, instrucțiunea lui apare pe ecranul șoferului și butoanele se
  // deblochează.
  const [blockingIncident, setBlockingIncident] = useState(null)
  const [dispatcherReply, setDispatcherReply] = useState(null)

  useEffect(() => {
    let active = true
    const load = () => {
      supabase
        .from('order_incidents')
        .select('*')
        .eq('order_id', order.id)
        .eq('blocks_delivery', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (!active) return
          const inc = data?.[0] || null
          if (!inc) { setBlockingIncident(null); return }
          if (inc.resolved_at) {
            setBlockingIncident(null)
            if (inc.dispatcher_note) setDispatcherReply(inc.dispatcher_note)
          } else {
            setBlockingIncident(inc)
          }
        })
    }
    load()

    const channel = supabase
      .channel('incidents-' + order.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_incidents', filter: `order_id=eq.${order.id}` }, load)
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
  }, [order.id])

  // Dokumentenzustellung, doar pe etapa de livrare — la ridicare nu are sens.
  const isDocumentDelivery = !!order.is_document_delivery
  const isDocumentDeliveryLeg = isDocumentDelivery && esteLivrareEtapa

  // Verificarea distanţei merge pe AMBELE etape ale unei livrări de
  // documente — şi ridicarea contează ca probă, nu doar predarea.
  const adresaEtapei = fapte.address
  // Coordonatele ţintei: întâi din comandă, dacă au fost deja aflate o dată.
  // Abia dacă lipsesc întrebăm Google — şi atunci le şi scriem în bază, ca
  // să nu se mai ceară niciodată pentru aceeaşi comandă.
  // Slotul de coordonate urmează ADRESA, nu felul etapei.
  //
  // La dus-întors adresele se schimbă între ele: `return_pickup_address` ESTE
  // adresa de livrare, iar `return_delivery_address` e cea de ridicare. Legat
  // de felul etapei, codul compara poziţia şoferului cu coordonatele celeilalte
  // adrese — iar la o livrare de documente, unde distanţa e verificată, asta
  // putea arăta „eşti la 300 km" şi bloca confirmarea. Şi mai scria
  // coordonatele greşite în bază, pentru totdeauna.
  // O oprire de tur îşi are propriile coordonate pe rândul ei. Capetele
  // cursei folosesc sloturile de pe comandă, iar la dus-întors adresele se
  // schimbă între ele — de aceea slotul urmează ADRESA, nu felul etapei.
  const slotCoord = (intrare.key === 'delivery' || intrare.key === 'return_pickup') ? 'delivery' : 'pickup'
  const coordSalvate = esteOprire
    ? (intrare.stop.lat != null && intrare.stop.lng != null ? [intrare.stop.lat, intrare.stop.lng] : null)
    : ((order[`${slotCoord}_lat`] != null && order[`${slotCoord}_lng`] != null)
        ? [order[`${slotCoord}_lat`], order[`${slotCoord}_lng`]]
        : null)

  const tintaGeocodata = useGeocode(isDocumentDelivery && !coordSalvate ? adresaEtapei : null)
  const tintaEtapei = coordSalvate || tintaGeocodata

  useEffect(() => {
    // La o oprire nu scriem nimic: coordonatele ei le pune dispeceratul când
    // alege adresa, iar aici n-avem drept de scriere pe rândul opririi.
    if (esteOprire || !isDocumentDelivery || coordSalvate || !tintaGeocodata) return
    supabase.rpc('driver_set_address_coords', {
      p_order_id: order.id,
      // Trimitem etapa adevărată; funcţia de pe server alege slotul potrivit.
      p_leg: leg,
      p_lat: tintaGeocodata[0],
      p_lng: tintaGeocodata[1],
    }).then(({ error }) => { if (error) console.error('coords save:', error.message) })
  }, [isDocumentDelivery, coordSalvate, tintaGeocodata && tintaGeocodata[0], tintaGeocodata && tintaGeocodata[1]])
  const distanta = useDistantaFataDe(tintaEtapei, isDocumentDelivery)
  const [avertismentDistanta, setAvertismentDistanta] = useState(null)

  // Trimiterea documentului către client, direct de la faţa locului.
  //
  // Cazul real: şoferul ajunge la încărcare şi expeditorul nu are CMR-ul
  // tipărit. Până acum suna la dispecerat şi aştepta. Adresa clientului e
  // propusă de server, ca să n-o scrie greşit de mână.
  // Regulile predării, aduse acolo unde se ia decizia.
  //
  // Şoferul le ştie din instructaj — dar le aplică în faţa uşii, obosit, la
  // a şasea livrare. O regulă semnată acum trei luni nu ajută în clipa aceea.
  const esteEtapaLivrareDoc = isDocumentDeliveryLeg

  // La predarea în cutia poştală, şase fotografii: clădirea, plicul lângă
  // cutie cu numele vizibile, plicul pe jumătate introdus, plicul intrat
  // complet, cadrul larg cu împrejurimile şi protocolul completat.
  //
  // Cea cu plicul pe jumătate pare de prisos lângă cea cu plicul intrat —
  // dar la cutiile adânci plicul dispare cu totul, iar ultima fotografie nu
  // mai arată nimic. Aceea e singura care prinde gestul.
  // Nu există semnătură: fotografiile SUNT dovada.
  const MINIM_POZE_LIVRARE = 6
  const [notitaPlecare, setNotitaPlecare] = useState(false)
  const [regulileDeschise, setRegulileDeschise] = useState(false)

  // Livrările obişnuite au două drumuri, după cum şoferul are sau nu hârtii
  // tipărite la el. Cu CMR: semnătura se dă pe hârtie, deci în aplicaţie nu
  // mai apare, dar documentul trebuie încărcat. Fără: semnătura în aplicaţie
  // şi numele destinatarului sunt singura dovadă.
  const esteLivrareNormala = !isDocumentDelivery && esteLivrareEtapa
  const [areActe, setAreActe] = useState(order.delivery_has_paperwork)

  async function raspundeActe(valoare) {
    setAreActe(valoare)
    const { error } = await supabase.rpc('driver_set_delivery_paperwork', {
      p_order_id: order.id, p_has: valoare,
    })
    if (error) console.error('paperwork:', error.message)
  }
  const [incidentOpen, setIncidentOpen] = useState(false)
  const [incidentBlocking, setIncidentBlocking] = useState(false)
  const [incidentSaved, setIncidentSaved] = useState(false)
  const [etaOpen, setEtaOpen] = useState(false)
  const [etaToast, setEtaToast] = useState('')
  // ETA e acum şi pe opriri: funcţia de server scrie în `trip_stops.eta_*`
  // şi trimite acelaşi email, cu adresa opririi şi „Stopp 7 von 20" în faţă.
  // Rămâne în afară doar returul — acolo nu există coloane, iar un buton care
  // pare să trimită şi nu trimite e mai rău decât unul care lipseşte.
  const etaAvailable = intrare.key === 'pickup' || intrare.key === 'delivery' || esteOprire
  const etaCount = esteOprire
    ? (intrare.stop.eta_count || 0)
    : (intrare.key === 'pickup' ? (order.pickup_eta_count || 0) : (order.delivery_eta_count || 0))

  const etaBlock = etaAvailable ? (
    <>
      <button
        type="button"
        onClick={() => setEtaOpen(true)}
        style={{
          width: '100%', background: '#fff', border: '1px solid #D8DEE8',
          borderRadius: 10, padding: '11px 14px', fontSize: 14, fontWeight: 600,
          color: '#0F2240', marginBottom: 10, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        }}
      >
        <Bell size={15} strokeWidth={2} />
        {etaCount > 0 ? t('etaButtonAgain', lang) : t('etaButton', lang)}
      </button>
      {etaToast && (
        <div style={{ background: '#EAF5EF', border: '1px solid #A8D5BE', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#1F7A50', marginBottom: 10 }}>
          ✓ {etaToast}
        </div>
      )}
      {etaOpen && (
        <EtaSheet
          order={order}
          leg={leg}
          entry={intrare}
          lang={lang}
          driverPhone={profile?.phone}
          onClose={() => setEtaOpen(false)}
          onSent={(count) => {
            setEtaOpen(false)
            setEtaToast(t('etaSentToast', lang).replace('{n}', count))
            setTimeout(() => setEtaToast(''), 6000)
          }}
        />
      )}
    </>
  ) : null

  const waitingBlock = (
    <>
      {blockingIncident && (
        <div style={{
          background: '#FFF6ED', border: '2px solid #FF7A29', borderRadius: 10,
          padding: '14px 15px', marginBottom: 12,
        }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#B35A12', marginBottom: 4 }}>
            ⏳ {t('waitingForDispatcher', lang)}
          </div>
          <div style={{ fontSize: 13, color: '#8A5A16', lineHeight: 1.5 }}>
            {t('waitingForDispatcherNote', lang)}
          </div>
          {blockingIncident.comment && (
            <div style={{ fontSize: 12.5, color: '#8A5A16', marginTop: 8, fontStyle: 'italic' }}>
              „{blockingIncident.comment}"
            </div>
          )}
        </div>
      )}

      {dispatcherReply && (
        <div style={{
          background: '#EAF0FB', border: '2px solid #2A5299', borderRadius: 10,
          padding: '14px 15px', marginBottom: 12,
        }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#2A5299', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>
            {t('dispatcherInstruction', lang)}
          </div>
          <div style={{ fontSize: 15, color: '#0F2240', lineHeight: 1.5 }}>{dispatcherReply}</div>
          <button type="button" className="link-btn" onClick={() => setDispatcherReply(null)} style={{ marginTop: 8 }}>
            {t('dispatcherInstructionAck', lang)}
          </button>
        </div>
      )}
    </>
  )

  const incidentBlock = (
    <>
      <button
        type="button"
        onClick={() => setIncidentOpen(true)}
        style={{
          width: '100%', background: '#fff', border: '1px solid #E4A296',
          borderRadius: 10, padding: '11px 14px', fontSize: 14, fontWeight: 600,
          color: '#B23A24', marginBottom: 10, cursor: 'pointer',
        }}
      >
        ⚠ {t('incidentButton', lang)}
      </button>
      {incidentSaved && (
        <div style={{ background: '#EAF5EF', border: '1px solid #A8D5BE', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#1F7A50', marginBottom: 10 }}>
          ✓ {t('incidentSaved', lang)}
        </div>
      )}
      {(incidentOpen || incidentBlocking) && (
        <IncidentSheet
          order={order}
          leg={leg}
          lang={lang}
          driverId={order.assigned_driver_id}
          blocking={incidentBlocking}
          onClose={() => { setIncidentOpen(false); setIncidentBlocking(false) }}
          onSaved={() => {
            setIncidentOpen(false)
            setIncidentBlocking(false)
            setIncidentSaved(true)
            setTimeout(() => setIncidentSaved(false), 8000)
          }}
        />
      )}
    </>
  )

  const undoBlock = (
    <>
      {undoable && (
        <UndoBar field={undoable.field} at={undoable.at} lang={lang} onUndo={undoStage} />
      )}
      {undoError && (
        <div style={{
          background: '#FCEBE8', border: '1px solid #E4A296', borderRadius: 10,
          padding: '9px 12px', fontSize: 13, color: '#B23A24', marginBottom: 10,
        }}>
          {undoError}
        </div>
      )}
    </>
  )

  // Fișierele nu mai stau în state-ul React, ci în coada persistentă
  // (IndexedDB). Ele supraviețuiesc refresh-ului, închiderii aplicației și
  // lipsei de semnal. Componenta PodFiles le afișează citind direct de acolo,
  // iar eliberarea preview-urilor se face în interiorul ei.
  function addPhotos(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length) enqueueFiles(order.id, leg, files, { kind: 'photo' })
  }

  const [docCaptureOpen, setDocCaptureOpen] = useState(false)

  const [uploadError, setUploadError] = useState('')

  async function confirmLeg() {
    if (busy) return
    setBusy(true)
    setUploadError('')
    try {
      if (signatureBlob) await enqueueSignature(order.id, leg, signatureBlob)

      // Poziția în momentul confirmării — doar la livrările de documente.
      //
      // La o predare în cutia poștală nu există semnătură: poziția e singura
      // dovadă că șoferul a fost efectiv la adresă. O singură citire, aici,
      // nu urmărire continuă.
      //
      // GPS-ul nu are nevoie de internet, deci funcționează și fără semnal.
      // Dacă telefonul refuză sau întârzie, confirmarea merge mai departe: o
      // livrare nu se blochează pentru o poziție lipsă.
      if (isDocumentDelivery) {
        try {
          // Reținem și MOTIVUL, când poziția lipsește.
          //
          // Telefonul raportează doar trei cauze: permisiune refuzată,
          // poziție indisponibilă, sau timp depășit. Mai mult nu se poate
          // ști — browserul nu spune dacă era o parcare subterană sau un
          // GPS oprit.
          //
          // Dar o rubrică goală pe un document se citește ca omisiune, iar
          // una cu motiv, ca informație. Diferența contează într-o dispută.
          const REASONS = { 1: 'denied', 2: 'unavailable', 3: 'timeout' }
          const result = await new Promise((resolve) => {
            if (!navigator.geolocation) return resolve({ pos: null, error: 'unavailable' })
            const timer = setTimeout(() => resolve({ pos: null, error: 'timeout' }), 8000)
            navigator.geolocation.getCurrentPosition(
              (p) => { clearTimeout(timer); resolve({ pos: p, error: null }) },
              (err) => { clearTimeout(timer); resolve({ pos: null, error: REASONS[err?.code] || 'unavailable' }) },
              { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
            )
          })

          // Distanţa se calculează AICI, în clipa bifei, şi se îngheaţă în
          // bază. Dovada o citeşte de acolo, în loc s-o recalculeze din
          // adresa de atunci — altfel o corectare ulterioară a adresei ar
          // schimba cifra de pe un document deja emis.
          //
          // Coordonatele adresei sunt deja în memorie (geocodare cu cache,
          // folosită de hartă şi de avertismentul de distanţă), deci nu se
          // mai cere nimic de la Google.
          const distantaMetri = (result.pos && tintaEtapei)
            ? Math.round(haversineKm(
                result.pos.coords.latitude, result.pos.coords.longitude,
                tintaEtapei[0], tintaEtapei[1],
              ) * 1000)
            : null

          // Etapa adevărată, nu strivită în două.
          //
          // Înainte, poziţia de la o etapă de retur se scria peste poziţia de
          // la etapa de dus: dovada primei livrări dispărea. Acum fiecare
          // etapă are coloanele ei — iar o oprire de tur le are pe rândul ei.
          const pozitie = {
            p_lat: result.pos ? result.pos.coords.latitude : null,
            p_lng: result.pos ? result.pos.coords.longitude : null,
            p_accuracy: result.pos ? Math.round(result.pos.coords.accuracy) : null,
            p_error: result.error,
            p_distance: distantaMetri,
          }
          await (esteOprire
            ? supabase.rpc('driver_set_stop_confirm_location', { p_stop_id: intrare.stop.id, ...pozitie })
            : supabase.rpc('driver_set_confirm_location', { p_order_id: order.id, p_leg: intrare.key, ...pozitie }))
        } catch (err) {
          console.error('confirm location failed:', err.message)
        }
      }

      // Modul de livrare se scrie separat: șoferul n-are drept direct pe
      // comenzi, iar RPC-ul de confirmare are o semnătură fixă folosită și de
      // Disponent, pe care n-o schimbăm.
      // Numai la capetele cursei: ambele funcţii scriu pe COMANDĂ, nu pe
      // oprire. La un tur cu cinci livrări, răspunsul fiecărei opriri îl
      // ştergea pe cel dinainte, iar dispeceratul vedea doar ultimul.
      if (!esteOprire && isDocumentDeliveryLeg && deliveryMethod) {
        const { error: dmErr } = await supabase.rpc('driver_set_delivery_method', {
          p_order_id: order.id,
          p_method: deliveryMethod,
        })
        if (dmErr) console.error('delivery method error:', dmErr.message)
      }

      // Fișierele au fost deja urcate de coadă, în fundal, pe măsură ce
      // șoferul le adăuga. Aici doar înregistrăm confirmarea cu aceleași
      // RPC-uri și același format ca înainte. Dacă nu e internet, confirmarea
      // se salvează local și pleacă automat când revine semnalul.
      const result = await queueConfirmLeg({
        orderId: order.id,
        leg,
        rpcName: confirmFn,
        signerName,
        // La o oprire, funcţia de pe server are nevoie şi de id-ul ei.
        extraPayload: esteOprire ? rpc.args : null,
      })

      // Marcăm etapa încheiată chiar dacă trimiterea aşteaptă internet.
      //
      // E o alegere, nu o scăpare: la un tur cu douăzeci de opriri, a lăsa
      // şoferul blocat pe oprirea 7 până revine semnalul ar opri toată ziua.
      // Mesajul de dedesubt îi spune limpede că trimiterea e în aşteptare, iar
      // sărbătoarea de la final nu se declanşează până nu pleacă.
      onStatusChange(campEtapa('confirmed'), undefined, result === 'pending')

      if (result === 'pending') {
        // Nu declanșăm ecranul de succes: datele sunt în siguranță pe telefon,
        // dar încă nu au ajuns la server. Un succes fals aici ar însemna o
        // comandă raportată ca livrată fără dovezi în sistem.
        setUploadError(t('confirmSavedOffline', lang))
        return
      }

      // Ultima etapă a turului, oricâte ar fi. Înainte era scris de mână
      // („livrarea, dacă nu e dus-întors, sau livrarea de retur"), ceea ce la
      // un tur cu cinci livrări ar fi sărbătorit după prima.
      const seq = tourLegSequence(order)
      if (seq.length && seq[seq.length - 1].key === intrare.key) {
        if (onDeliveryComplete) onDeliveryComplete()
      }
    } catch (err) {
      console.error('confirm leg error:', err.message)
      setUploadError(t('uploadFailedError', lang))
    } finally {
      setBusy(false)
    }
  }

  // IMPORTANT: acest hook trebuie apelat necondiționat, ÎNAINTE de orice
  // `return` din componentă — altfel React primește un număr diferit de
  // hook-uri între randări (ex. la trecerea de la butonul "Ajuns" la
  // formularul de confirmare) și randarea se rupe, ceea ce se manifesta ca
  // interfața/poza rămasă "blocată" imediat după marcarea sosirii.
  //
  // NU mai blocăm document.body.style.overflow aici — componenta nu se
  // demontează garantat la schimbarea de tab în aplicație, iar dacă
  // utilizatorul iese din ecran fără să confirme ridicarea/livrarea,
  // blocarea rămânea activă global și îngheța tot ecranul (nu se mai putea
  // derula sau apăsa butoane), chiar și după revenirea la comandă.
  useEffect(() => {}, [arrivedAt])

  if (!startedAt) {
    return (
      <>
        {undoBlock}
        {/* Butonul spune încotro. La un tur cu douăzeci de opriri, „Losfahren"
            singur nu-i spune şoferului nimic: toate cardurile arată la fel,
            iar el apasă fără să ştie spre care adresă porneşte. */}
        <button className="btn sticky-cta" onClick={() => callRpc(startFn)} disabled={busy}>
          {t('startDriving', lang)}{numar ? ` · ${legLabel}` : ''}
        </button>
      </>
    )
  }

  if (!arrivedAt) {
    return (
      <>
        {undoBlock}
        {/* Pe tot ecranul, nu o casetă pe margine: şoferul tocmai a apăsat
            „pornesc" şi se uită la telefon o clipă — în clipa aceea trebuie
            să dea peste regulă, nu s-o caute. Dispare singură. */}
        {notitaPlecare && (
          <div
            onClick={() => setNotitaPlecare(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 9998, background: '#B35A12',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: 28, textAlign: 'center', color: '#fff', cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 46, marginBottom: 18 }}>📄</div>
            <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.4, maxWidth: 420 }}>
              {t('docRuleShort', lang)}
            </div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 22 }}>
              {t('docRuleAutoClose', lang)}
            </div>
          </div>
        )}
        {etaBlock}
        {/* La documente, butonul se estompează cât timp şoferul e departe.
            Nu e dezactivat: la atingere spune de ce, cu distanţa în metri,
            şi lasă o portiţă dacă poziţia telefonului e greşită. */}
        <button
          className={`btn sticky-cta ${distanta.preaDeparte ? 'needs-proximity' : ''}`}
          onClick={() => {
            // Blocaj real, fără a doua atingere. Portiţa dinainte nu lăsa
            // nicio urmă: nu se putea şti dacă şoferul a văzut avertismentul
            // sau a trecut peste el. Cât timp telefonul ştie SIGUR unde e şi
            // e dincolo de prag, nu se marchează nimic.
            if (distanta.preaDeparte) {
              setAvertismentDistanta(distanta.metri)
              return
            }
            // La livrarea de documente, regulile apar ÎNAINTE de marcarea
            // sosirii — adică înainte ca şoferul să sune la uşă.
            if (esteEtapaLivrareDoc) {
              setRegulileDeschise(true)
              return
            }
            callRpc(arriveFn)
          }}
          disabled={busy}
        >
          {t('arrived', lang)}{numar ? ` · ${legLabel}` : ''}
        </button>

        {/* Regulile predării, într-o fereastră care cere o confirmare.
            Nu e o bifă în plus la fiecare livrare: apare o singură dată,
            la sosire, exact înainte de momentul în care contează. */}
        {regulileDeschise && (
          <div
            style={{
              position: 'fixed', inset: 0, background: '#fff', zIndex: 9999,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
              overflowY: 'auto',
              paddingTop: 'calc(26px + env(safe-area-inset-top, 0px))',
              paddingBottom: 'calc(26px + env(safe-area-inset-bottom, 0px))',
              paddingLeft: 20, paddingRight: 20,
            }}
          >
            <div style={{ maxWidth: 440, width: '100%' }}>
              <div style={{ fontSize: 42, marginBottom: 10 }}>📄</div>
              <div style={{ fontSize: 21, fontWeight: 800, color: '#0F2240', marginBottom: 16, lineHeight: 1.3 }}>
                {t('docRulesTitle', lang)}
              </div>
              <ol style={{ paddingLeft: 22, margin: 0, fontSize: 15, lineHeight: 1.7, color: '#0F2240' }}>
                <li style={{ marginBottom: 13 }}>{t('docRule1', lang)}</li>
                <li style={{ marginBottom: 13 }}>{t('docRule2', lang)}</li>
                <li style={{ marginBottom: 13 }}>{t('docRule3', lang)}</li>
              </ol>
              <div style={{
                background: '#F3FBF6', border: '1px solid #BFE8CF', borderRadius: 9,
                padding: '10px 12px', fontSize: 13, color: '#1B6E43', lineHeight: 1.55, margin: '14px 0 16px',
              }}>
                {t('docRuleContact', lang)}
              </div>
              <button
                className="btn"
                style={{ width: '100%' }}
                onClick={() => { setRegulileDeschise(false); callRpc(arriveFn) }}
              >
                {t('docRulesAck', lang)}
              </button>
            </div>
          </div>
        )}
        {/* Starea măsurătorii, scrisă. Un blocaj mut nu se poate verifica:
            dacă poziția nu e încă gata sau e nesigură, butonul arată normal
            și nimeni nu știe de ce. Acum se vede mereu pe ce ne bazăm. */}
        {isDocumentDelivery && (
          <div style={{ fontSize: 11.5, color: 'var(--text-soft)', textAlign: 'center', marginTop: 6 }}>
            {!tintaEtapei
              ? t('distUnknownAddress', lang)
              : distanta.metri == null
                ? t('distMeasuring', lang)
                : distanta.sigur
                  ? t('distKnown', lang).replace('{d}', distanta.metri >= 1000 ? `${(distanta.metri / 1000).toFixed(1)} km` : `${distanta.metri} m`)
                  : t('distUnsure', lang)
                      .replace('{d}', distanta.metri >= 1000 ? `${(distanta.metri / 1000).toFixed(1)} km` : `${distanta.metri} m`)
                      .replace('{m}', distanta.marja != null ? `${distanta.marja}` : '?')}
          </div>
        )}
        {avertismentDistanta != null && (
          <div style={{
            marginTop: 8, padding: '10px 12px', borderRadius: 9,
            background: '#FCEBE8', border: '1px solid #E4A296', color: '#B23A24',
            fontSize: 13, lineHeight: 1.55,
          }}>
            <div style={{ fontWeight: 700 }}>
              ⚠ {t('tooFarTitle', lang).replace('{m}', avertismentDistanta)}
            </div>
            <div style={{ marginTop: 3 }}>{t('tooFarHint', lang)}</div>
            {/* Singura ieşire când poziţia chiar e greşită: dispeceratul.
                Aşa rămâne o urmă scrisă, în loc de o a doua atingere
                despre care nimeni nu află niciodată. */}
            <a
              href={dispatchWaUrl(order, fapte)}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                marginTop: 10, background: '#25D366', color: '#fff', fontWeight: 700,
                fontSize: 13.5, padding: '9px 12px', borderRadius: 8, textDecoration: 'none',
              }}
            >
              <WhatsAppIcon size={14} />
              {t('tooFarContact', lang)}
            </a>
          </div>
        )}
        {incidentBlock}
      </>
    )
  }

  return (
    <div className="leg-workflow">
      {undoBlock}
      {waitingBlock}

      {/* Întrebarea se pune o singură dată, la începutul confirmării, şi
          hotărăşte ce se cere mai jos. Până la răspuns nu arătăm formularul:
          altfel şoferul completează pe un drum şi află la final că era
          celălalt. */}
      {esteLivrareNormala && areActe == null && (
        <div style={{
          background: '#FFF6ED', border: '1px solid #FFD2AE', borderRadius: 10,
          padding: '14px 14px 12px', margin: '10px 0 14px',
        }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#0F2240', marginBottom: 4 }}>
            {t('paperworkQuestion', lang)}
          </div>
          <div style={{ fontSize: 12.5, color: '#8A5A16', marginBottom: 12, lineHeight: 1.5 }}>
            {t('paperworkQuestionNote', lang)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => raspundeActe(true)}>
              {t('paperworkYes', lang)}
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => raspundeActe(false)}>
              {t('paperworkNo', lang)}
            </button>
          </div>
        </div>
      )}

      {/* Răspunsul se poate schimba. O apăsare greşită nu are voie să ducă
          într-o fundătură: fără asta, un „am hârtii" apăsat din greşeală
          cerea un document inexistent, iar livrarea rămânea deschisă. */}
      {esteLivrareNormala && areActe != null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          fontSize: 12.5, color: 'var(--text-soft)', margin: '8px 0 2px',
        }}>
          <span>
            {areActe ? '📄 ' + t('paperworkYes', lang) : '✍️ ' + t('paperworkNo', lang)}
          </span>
          <button
            onClick={() => raspundeActe(!areActe)}
            style={{
              border: '1px solid var(--border, #E2E7EE)', background: 'transparent',
              borderRadius: 14, padding: '3px 10px', fontSize: 12, fontWeight: 700,
              color: 'var(--text-soft)', cursor: 'pointer',
            }}
          >
            {t('paperworkChange', lang)}
          </button>
        </div>
      )}

      <div className="leg-title">{legLabel} · {t('confirmStep', lang)}</div>

      {/* Cu cine are de-a face, chiar aici.
          În pasul cu pozele, numele şi adresa rămâneau sus, deci şoferul
          trebuia să dea înapoi ca să le vadă — tocmai când are telefonul
          într-o mână şi plicul în cealaltă. La livrare apare şi de unde a
          fost ridicat, pentru că asta îl întreabă destinatarul. */}
      {(() => {
        // `esteLivrareEtapa` şi `fapte` vin din etapa adevărată. Comparat cu
        // text, `leg` (un id de oprire) ieşea mereu „ridicare", deci caseta
        // arăta adresa depozitului principal în timp ce şoferul stătea la
        // livrarea 7 din 20 — exact informaţia pentru care există caseta.
        const laLivrare = esteLivrareEtapa
        // Adresa şi contactul vin din `fapte`, adică din etapa adevărată.
        //
        // Înainte se luau din coloanele comenzii: la livrarea 7 din 20, caseta
        // arăta adresa destinatarului principal şi contactul lui — alt nume,
        // altă stradă, exact informaţia pentru care există caseta.
        const contact = esteOprire
          ? ([fapte.company, fapte.contactName].filter(Boolean).join(' · ')
             + (fapte.contactPhone ? ` · Tel. ${fapte.contactPhone}` : '')).trim() || null
          : extractContact(order.notes, laLivrare ? 'Kontakt Zustellung: ' : 'Kontakt Abholung: ')
        const adresa = fapte.address
        // Expeditorul, citit o singură dată: și pe linia "Abgeholt bei", și
        // la butonul de mai jos.
        const contactRidicare = extractContact(order.notes, 'Kontakt Abholung: ')
        if (!contact && !adresa) return null
        return (
          <div style={{
            background: 'var(--surface-soft, #F4F6F9)', border: '1px solid var(--border, #E2E7EE)',
            borderRadius: 9, padding: '9px 11px', margin: '8px 0 12px', fontSize: 13, lineHeight: 1.55,
          }}>
            {contact && (
              <div style={{ fontWeight: 700 }}>
                {laLivrare ? '📥' : '📤'} {contact.split(' · Tel.')[0].trim()}
              </div>
            )}
            {adresa && <div style={{ color: 'var(--text-soft)' }}>{adresa}</div>}
            {/* Adresa singură nu-i spunea nimic destinatarului care întreabă
                "de la cine vine?". Numele și firma expeditorului stau în
                `notes`, lângă adresă. Se arată și la opriri: tocmai la livrarea
                7 din 20 nu mai ţine minte nimeni de unde a plecat marfa. */}
            {laLivrare && (contactRidicare || order.pickup_address) && (
              <div style={{ color: 'var(--text-soft)', marginTop: 5, fontSize: 12.5 }}>
                {t('pickedUpFrom', lang)}: {[
                  contactRidicare ? contactRidicare.split(' \u00b7 Tel.')[0].trim() : null,
                  order.pickup_address || null,
                ].filter(Boolean).join(' \u00b7 ')}
              </div>
            )}
          </div>
        )
      })()}

      {/* La ridicare arată unde merge marfa; la livrare, de la cine a fost
          luată. Deasupra pozelor, în pasul în care șoferul se uită oricum. */}
      <AltCapat order={order} lang={lang} spreLivrare={!esteLivrareEtapa} />

      {/* Același bloc și aici: când șoferul e la rampă și expeditorul nu are
          nimic tipărit, el stă în pasul cu pozele — cardurile de sus sunt
          ascunse, deci butonul de acolo nu i-ar fi la îndemână. */}
      <div style={{ marginBottom: 12 }}>
        <TrimiteDocument order={order} lang={lang} />
      </div>

      <PodFiles
        orderId={order.id}
        leg={leg}
        lang={lang}
        onAddPhoto={() => setPhotoSourceOpen(true)}
        maxPhotos={esteEtapaLivrareDoc && deliveryMethod === 'briefkasten' ? 8 : 6}
        onSummary={setFileSummary}
        photoHints={
          esteEtapaLivrareDoc
            ? (deliveryMethod === 'briefkasten'
                ? [t('hintGebaeude', lang), t('hintUmschlagName', lang), t('hintHalbEingeworfen', lang), t('hintEingeworfen', lang), t('hintUmgebung', lang), t('hintProtokoll', lang)]
                : (deliveryMethod === 'persoenlich' ? [t('hintGebaeude', lang)] : []))
            : (esteLivrareNormala ? [t('hintWare1', lang), t('hintWare2', lang)] : [])
        }
      />

      {photoSourceOpen && (
        <div className="sig-fullscreen" style={{ justifyContent: 'flex-end', background: 'rgba(15,34,64,.55)' }}>
          <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '20px 20px calc(20px + env(safe-area-inset-bottom))' }}>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 17, color: 'var(--navy)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.03em' }}>
              {t('photosLabel', lang)}
            </div>
            <button type="button" className="btn secondary" style={{ width: '100%', marginTop: 0, marginBottom: 10 }} onClick={() => { setPhotoSourceOpen(false); cameraInputRef.current?.click() }}>
              📷 {t('takePhoto', lang)}
            </button>
            <button type="button" className="btn secondary" style={{ width: '100%', marginTop: 0, marginBottom: 10 }} onClick={() => { setPhotoSourceOpen(false); fileInputRef.current?.click() }}>
              🖼️ {t('chooseFromGallery', lang)}
            </button>
            <button type="button" className="link-btn" onClick={() => setPhotoSourceOpen(false)}>{t('back', lang)}</button>
          </div>
        </div>
      )}

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={addPhotos}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={addPhotos}
      />

      <div className="pod-label">{t('documentsLabel', lang)}</div>
      <button
        type="button"
        className="btn secondary"
        style={{ width: '100%', marginTop: 0 }}
        onClick={() => setDocCaptureOpen(true)}
      >
        {t('addDocument', lang)}
      </button>

      {docCaptureOpen && (
        <DocumentCapture
          lang={lang}
          onClose={() => setDocCaptureOpen(false)}
          onPick={(file, pickedType) => {
            setDocCaptureOpen(false)
            enqueueFiles(order.id, leg, [file], { kind: 'document', docType: pickedType })
          }}
        />
      )}


      {/* Șoferul trebuie să știe de ce contează locul în care apasă.
          Fără explicație, mulți confirmă din mașină sau după ce au plecat —
          iar atunci dovada arată o poziție greșită, exact în cazul în care
          ea este singura dovadă existentă. */}
      {isDocumentDelivery && (
        <div style={{
          background: '#EAF0FB', border: '2px solid #2A5299', borderRadius: 10,
          padding: '13px 15px', marginBottom: 14,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#2A5299', marginBottom: 4 }}>
            📍 {t('locationNoticeTitle', lang)}
          </div>
          <div style={{ fontSize: 13, color: '#2A5299', lineHeight: 1.5 }}>
            {t('locationNoticeBody', lang)}
          </div>
        </div>
      )}

      {/* Dokumentenzustellung: cum a fost predat documentul.
          Protocolul pe hârtie rămâne dovada oficială — șoferul îl are tipărit
          și îl completează cu pixul. Dar modul de livrare trebuie să existe și
          ca informație în sistem, altfel se vede doar deschizând PDF-ul scanat.

          Diferența practică: la Briefkasten nu există cui să semneze, deci nu
          mai cerem semnătură și nume. Dovada sunt fotografiile. */}
      {isDocumentDeliveryLeg && (
        <>
          <div className="pod-label">{t('deliveryMethodLabel', lang)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {[
              { id: 'briefkasten', key: 'deliveryMethodBriefkasten', note: 'deliveryMethodBriefkastenNote' },
              { id: 'persoenlich', key: 'deliveryMethodPersoenlich', note: 'deliveryMethodPersoenlichNote' },
            ].map((m) => {
              const active = deliveryMethod === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setDeliveryMethod(m.id)}
                  style={{
                    width: '100%', textAlign: 'left', cursor: 'pointer',
                    background: active ? '#FFF6ED' : '#fff',
                    border: `2px solid ${active ? '#FF7A29' : '#D8DEE8'}`,
                    borderRadius: 10, padding: '13px 15px',
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 700, color: active ? '#B35A12' : '#0F2240' }}>
                    {active ? '● ' : '○ '}{t(m.key, lang)}
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7A90', marginTop: 3, lineHeight: 1.45 }}>
                    {t(m.note, lang)}
                  </div>
                  {/* Condiţia care face predarea în cutie admisibilă, scrisă
                      chiar pe opţiune — nu într-un document de la instructaj. */}
                  {m.id === 'persoenlich' && (
                    <div style={{
                      fontSize: 12, color: '#1B6E43', background: '#F3FBF6',
                      border: '1px solid #BFE8CF', borderRadius: 7,
                      padding: '7px 9px', marginTop: 7, lineHeight: 1.5, fontWeight: 600,
                    }}>
                      ✍️ {t('persoenlichCondition', lang)}
                    </div>
                  )}
                  {m.id === 'briefkasten' && (
                    <div style={{
                      fontSize: 12, color: '#B35A12', background: '#FFF6ED',
                      border: '1px solid #FFD2AE', borderRadius: 7,
                      padding: '7px 9px', marginTop: 7, lineHeight: 1.5, fontWeight: 600,
                    }}>
                      ⚠ {t('briefkastenCondition', lang)}
                    </div>
                  )}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setIncidentBlocking(true)}
              disabled={!!blockingIncident}
              style={{
                width: '100%', textAlign: 'left',
                cursor: blockingIncident ? 'not-allowed' : 'pointer',
                opacity: blockingIncident ? 0.5 : 1,
                background: '#fff', border: '1px solid #E4A296', borderRadius: 10,
                padding: '13px 15px', fontSize: 14.5, fontWeight: 600, color: '#B23A24',
              }}
            >
              ⚠ {t('deliveryMethodImpossible', lang)}
              <div style={{ fontSize: 12, color: '#6B7A90', marginTop: 3, fontWeight: 400, lineHeight: 1.45 }}>
                {t('deliveryMethodImpossibleNote', lang)}
              </div>
            </button>
          </div>
        </>
      )}

      {/* La Briefkasten nu are cine semna — nu cerem nume și semnătură. */}
      {!(isDocumentDeliveryLeg && deliveryMethod === 'briefkasten') && (
      <>
      <div className="pod-label">{t(esteLivrareEtapa ? 'signerNameLabelDelivery' : 'signerNameLabelPickup', lang)}</div>
      <input
        className="bid-input2"
        type="text"
        value={signerName}
        onChange={(e) => setSignerName(e.target.value)}
        placeholder={t('signerNamePlaceholder', lang)}
      />

      {/* La livrarea de documente destinatarul semnează pe Zustellprotokoll,
          pe hârtie — nu pe ecran. Două semnături pentru acelaşi act înseamnă
          două dovezi care se pot contrazice, iar cea de pe hârtie e cea care
          contează. Deci aici câmpul nici nu apare. */}
      {!esteEtapaLivrareDoc && !(esteLivrareNormala && areActe === true) && (
        <>
          {isDocumentDelivery && (
            <div style={{
              fontSize: 12.5, color: '#B35A12', background: '#FFF6ED',
              border: '1px solid #FFD2AE', borderRadius: 7,
              padding: '8px 10px', margin: '8px 0 4px', lineHeight: 1.5, fontWeight: 600,
            }}>
              ⚠ {t('pickupSignatureRule', lang)}
            </div>
          )}
          <SignatureLine lang={lang} signatureBlob={signatureBlob} onChange={setSignatureBlob} />
          {/* La ridicare nu întrebăm nimic despre acte: foile de transport
              se primesc adesea chiar acolo, la încărcare. Doar o mențiune,
              ca şoferul să ştie că semnătura în aplicaţie nu e necesară
              dacă oricum semnează pe hârtie. */}
          {!isDocumentDelivery && !esteLivrareEtapa && (
            <div style={{ fontSize: 11.5, color: 'var(--text-soft)', marginTop: 5, lineHeight: 1.5 }}>
              {t('pickupSignatureNote', lang)}
            </div>
          )}
        </>
      )}
      </>
      )}

      {uploadError && (
        <div style={{ background: '#FCEBE8', border: '1px solid #E4A296', borderRadius: 10, padding: '10px 12px', fontSize: 15.5, color: '#B23A24', marginTop: 4 }}>
          ⚠️ {uploadError}
        </div>
      )}

      {/* Aceeaşi plasă la bifa de încărcare/predare: cât timp ştim sigur că
          şoferul e la peste 70 m, butonul e în ceaţă şi explică la atingere. */}
      {/* Ce îi lipseşte şoferului ca să poată închide etapa.
          Până acum butonul era doar stins, fără să spună de ce — iar la
          livrările de documente lipsa Zustellprotokoll-ului se descoperea
          abia la dispecerat, când omul plecase demult de la adresă. */}
      {turIncomplet && (
        <div style={{ background: '#FFF7E8', border: '1px solid #F0B94D', borderRadius: 10, padding: '11px 13px', marginTop: 12 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#7A4E10', marginBottom: 3 }}>
            {t('tourIncompleteTitle', lang)}
          </div>
          <div style={{ fontSize: 12.5, color: '#6B5430', lineHeight: 1.5 }}>
            {t('tourIncompleteNote', lang)} ({opririDeschise})
          </div>
        </div>
      )}

      {(() => {
        if (!isDocumentDelivery && !esteLivrareNormala) return null
        const lipsa = []

        // Livrare obişnuită: cerinţele depind de răspunsul despre hârtii.
        if (esteLivrareNormala) {
          if (areActe == null) return null
          if (fileSummary.photoCount < 2) {
            lipsa.push(t('missingPhotosMin', lang).replace('{n}', 2).replace('{have}', fileSummary.photoCount))
          }
          if (areActe === true && fileSummary.documentCount === 0) lipsa.push(t('missingCmr', lang))
          if (areActe === false && !signerName.trim()) lipsa.push(t('missingSigner', lang))
          if (areActe === false && !signatureBlob) lipsa.push(t('missingSignature', lang))
          if (!lipsa.length) return null
          return (
            <div style={{
              marginTop: 12, padding: '10px 12px', borderRadius: 9,
              background: '#FFF6ED', border: '1px solid #FFD2AE', color: '#B35A12',
              fontSize: 13, lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 700 }}>⚠ {t('requiredBeforeConfirm', lang)}</div>
              {lipsa.map((x, i) => <div key={i}>• {x}</div>)}
            </div>
          )
        }

        // La predarea personală proba e Zustellprotokoll-ul semnat de
        // destinatar; o fotografie a clădirii ajunge. La cutia poştală nu
        // există semnătură, deci fotografiile SUNT singura dovadă.
        const minimPoze = (esteEtapaLivrareDoc && deliveryMethod === 'briefkasten')
          ? MINIM_POZE_LIVRARE
          : 1
        if (fileSummary.photoCount < minimPoze) {
          lipsa.push(
            minimPoze > 1
              ? t('missingPhotosMin', lang)
                  .replace('{n}', minimPoze)
                  .replace('{have}', fileSummary.photoCount)
              : t('missingPhotos', lang)
          )
        }
        if (fileSummary.documentCount === 0) lipsa.push(t('missingProtokoll', lang))
        if (isDocumentDeliveryLeg && !deliveryMethod) lipsa.push(t('missingMethod', lang))
        if (!lipsa.length) return null
        return (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 9,
            background: '#FFF6ED', border: '1px solid #FFD2AE', color: '#B35A12',
            fontSize: 13, lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 700 }}>⚠ {t('requiredBeforeConfirm', lang)}</div>
            {lipsa.map((x, i) => <div key={i}>• {x}</div>)}
          </div>
        )
      })()}

      <button
        className={`btn ${distanta.preaDeparte ? 'needs-proximity' : ''}`}
        onClick={() => {
          if (distanta.preaDeparte) {
            setAvertismentDistanta(distanta.metri)
            return
          }
          confirmLeg()
        }}
        // Fără internet, dovezile rămân în coadă şi `allDone` nu devine
        // niciodată adevărat. Blocat pe asta, şoferul nu putea nici confirma,
        // nici merge mai departe — stătea într-un subsol cu turul oprit.
        // Acum confirmarea se pune în aşteptare, întreagă, şi pleacă singură
        // când revine semnalul.
        disabled={busy || !!blockingIncident || turIncomplet || fileSummary.total === 0
          || (reteaDisponibila() && !fileSummary.allDone)
          || (isDocumentDeliveryLeg && !deliveryMethod)
          || (esteLivrareNormala && (
                areActe == null
                || fileSummary.photoCount < 2
                || (areActe === true && fileSummary.documentCount === 0)
                || (areActe === false && (!signerName.trim() || !signatureBlob))
              ))
          || (isDocumentDelivery && (
                fileSummary.photoCount < ((esteEtapaLivrareDoc && deliveryMethod === 'briefkasten') ? MINIM_POZE_LIVRARE : 1)
                || fileSummary.documentCount === 0
              ))}
        style={{ marginTop: 14 }}
      >
        {busy
          ? t('uploadingLabel', lang)
          : fileSummary.total > 0 && !fileSummary.allDone
            ? t('waitingForUploads', lang)
            : esteLivrareEtapa ? t('confirmDelivery', lang) : t('confirmPickup', lang)}
      </button>

      {/* Scăparea, exact unde e nevoie de ea.
          Înainte butonul exista doar pe cardul opririi — iar cardurile se
          ascund tocmai în pasul de confirmare. Şoferul ajungea la o poartă
          închisă, apăsa „Am ajuns", şi rămânea în faţa unui formular de poze
          pe care nu-l putea completa, fără nicio ieşire. */}
      {esteOprire && onStopFailed && (
        <button
          type="button"
          className="link-btn danger-link"
          onClick={onStopFailed}
          disabled={busy}
        >
          ✕ {t('stopFailedButton', lang)}
        </button>
      )}

      {/* Ieșirile, mutate sub butonul de confirmare.
          Sus, deasupra pozelor, "Problem melden" era primul lucru pe care îl
          vedea șoferul în pasul de confirmare — și cel mai ușor de atins din
          greșeală cu telefonul într-o mână. Aici sunt căutate: după ce
          confirmarea nu merge. */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line, #E2E7EE)' }}>
        {incidentBlock}
        <a
          href={dispatchWaUrl(order, fapte)}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            color: '#1B9E50', border: '1px solid #BFE8CF', background: '#F3FBF6',
            fontSize: 13.5, fontWeight: 600, padding: '10px 12px', borderRadius: 10,
            textDecoration: 'none',
          }}
        >
          <WhatsAppIcon size={15} />
          {t('dispatchWa', lang)}
        </a>
      </div>
    </div>
  )
}

function useCompanyName(createdBy) {
  const [name, setName] = useState(null)
  useEffect(() => {
    if (!createdBy) return
    supabase
      .rpc('get_company_name', { p_profile_id: createdBy })
      .then(({ data }) => setName(data || null))
      .catch(() => {})
  }, [createdBy])
  return name
}

function useSignedUrls(paths) {
  const [urls, setUrls] = useState([])
  useEffect(() => {
    if (!paths || paths.length === 0) {
      setUrls([])
      return
    }
    let active = true
    Promise.all(
      paths.map((p) =>
        supabase.storage.from('proof-of-delivery').createSignedUrl(p, 3600).then((r) => r.data?.signedUrl)
      )
    ).then((results) => {
      if (active) setUrls(results.filter(Boolean))
    })
    return () => { active = false }
  }, [JSON.stringify(paths)])
  return urls
}

function useSignedUrl(path) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!path) { setUrl(null); return }
    let active = true
    supabase.storage.from('proof-of-delivery').createSignedUrl(path, 3600).then((r) => {
      if (active) setUrl(r.data?.signedUrl || null)
    })
    return () => { active = false }
  }, [path])
  return url
}

function durationLabel(fromIso, toIso) {
  if (!fromIso || !toIso) return ''
  const mins = Math.round((new Date(toIso) - new Date(fromIso)) / 60000)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}min`
}

function docTypeLabel(type, lang) {
  if (type === 'cmr') return t('docTypeCmr', lang)
  if (type === 'zustellprotokoll') return t('docTypeProtocol', lang)
  return t('docTypeOther', lang)
}

function DocumentLink({ doc, lang }) {
  const url = useSignedUrl(doc.path)
  if (!url) return null
  return (
    <div className="tl-sig">
      📄 <a href={url} target="_blank" rel="noreferrer">{docTypeLabel(doc.type, lang)}{doc.name ? ` · ${doc.name}` : ''}</a>
    </div>
  )
}

function TimelineLeg({ leg, entry, order, lang }) {
  // Etapa, fie ca obiect (din listă), fie ca text, pentru apelurile vechi.
  const intrare = entry || {
    key: leg,
    kind: (leg === 'delivery' || leg === 'return_delivery') ? 'delivery' : 'pickup',
    stop: null,
  }
  const esteOprire = !!intrare.stop
  const f = legFacts(order, intrare)
  const startedAt = f.startedAt
  const arrivedAt = f.arrivedAt
  const confirmedAt = f.confirmedAt
  // Numele coloanelor urmează numele etapei, deci merge şi pentru retur —
  // până acum dovezile de la dus-întors nu se vedeau deloc aici.
  const photoPaths = esteOprire ? intrare.stop.photos : order[`${intrare.key}_photos`]
  const docBrut = esteOprire ? intrare.stop.documents : order[`${intrare.key}_documents`]
  const documents = Array.isArray(docBrut) ? docBrut : []
  const signaturePath = esteOprire ? intrare.stop.signature_url : order[`${intrare.key}_signature_url`]
  const signerName = esteOprire ? intrare.stop.signer_name : order[`${intrare.key}_signer_name`]
  const photoUrls = useSignedUrls(photoPaths || [])
  const signatureUrl = useSignedUrl(signaturePath)

  // Oprirea ratată n-a început niciodată, dar trebuie să se vadă: ea e
  // explicaţia unei livrări care lipseşte.
  if (!startedAt && !f.failedAt) return null

  const numar = legCounter(order, intrare)
  const esteLivrareEtapa = intrare.kind === 'delivery'
  const eticheta = [
    esteLivrareEtapa ? `🅑 ${t('delivery', lang)}` : `🅐 ${t('pickup', lang)}`,
    numar ? `${numar.n} / ${numar.total}` : null,
    (intrare.key === 'return_pickup' || intrare.key === 'return_delivery') ? `(${t('returnLabel', lang)})` : null,
  ].filter(Boolean).join(' ')

  if (f.failedAt) {
    return (
      <>
        <div className="tl-leg-label">{eticheta}</div>
        <div className="tl-step">
          <div className="tl-title" style={{ color: '#8A2A17' }}>✕ {t('stopFailedLabel', lang)}</div>
          <div className="tl-time">{fmtDateTime(f.failedAt)}{f.failedReason ? ` · ${f.failedReason}` : ''}</div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="tl-leg-label">{eticheta}</div>
      <div className="tl-step">
        <div className="tl-title">{t('startDriving', lang)}</div>
        <div className="tl-time">{fmtDateTime(startedAt)}</div>
      </div>
      {arrivedAt && (
        <div className="tl-step">
          <div className="tl-title">{t('arrived', lang)}</div>
          <div className="tl-time">{fmtDateTime(arrivedAt)} · {durationLabel(startedAt, arrivedAt)}</div>
        </div>
      )}
      {confirmedAt && (
        <div className="tl-step">
          <div className="tl-title">{esteLivrareEtapa ? t('confirmDelivery', lang) : t('confirmPickup', lang)}</div>
          <div className="tl-time">{fmtDateTime(confirmedAt)} · {durationLabel(arrivedAt, confirmedAt)}</div>
          {photoUrls.length > 0 && (
            <div className="tl-photos">
              {photoUrls.map((u, i) => <img key={i} src={u} alt="" className="tl-photo" />)}
            </div>
          )}
          {documents.map((doc, i) => <DocumentLink key={i} doc={doc} lang={lang} />)}
          {signatureUrl && (
            <div className="tl-signature">
              <img src={signatureUrl} alt="" className="tl-signature-img" />
              {signerName && <div className="tl-signature-name">{signerName}</div>}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function CompletedOrderDetail({ order, isOwner, lang, onBack }) {
  const pickupCoords = useGeocode(order.pickup_address)
  const deliveryCoords = useGeocode(order.delivery_address)
  const companyName = useCompanyName(order.created_by)
  const opririTur = tourStops(order)
  // Aceeaşi ordine ca pe ecranul cursei în desfăşurare: ordinea de mers.
  const secventaOpriri = tourLegSequence(order).filter((e) => e.stop)
  const coordOpririDupaAdresa = useGeocodeMany(opririTur.map((st) => st.address))
  // Memorat: fără asta, lista era un obiect nou la fiecare randare, iar harta
  // se dărâma şi se redesena de fiecare dată.
  const puncteOpriri = useMemo(() => secventaOpriri
    .map((e) => {
      const st = e.stop
      const c = legCounter(order, e)
      return {
        kind: st.kind,
        label: `${st.kind === 'delivery' ? 'B' : 'A'}${c ? c.n : ''}`,
        coords: (st.lat != null && st.lng != null) ? [st.lat, st.lng] : coordOpririDupaAdresa[st.address],
      }
    })
    .filter((x) => x.coords),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(secventaOpriri.map((e) => [e.stop.id, e.stop.kind, e.stop.address, e.stop.lat, e.stop.lng])), coordOpririDupaAdresa])

  const net = earningsAmount(order)

  return (
    <div className="ride-detail">
      <button className="back-btn" onClick={onBack}>← {t('back', lang)}</button>

      <div className="ride-detail-header">
        <span className="ride-ref">{t('orderRef', lang)} {order.order_number || order.reference || order.id.slice(0, 8)}</span>
        <span className={`ride-badge ${statusClass(order.status)}`}>{statusLabel(order.status, lang)}</span>
      </div>

      {order.status === 'cancelled' && (
        <div className="cancel-box">
          <div className="cancel-title">{t('cancelledLabel', lang)}</div>
          {order.cancellation_note && <div className="cancel-note">{order.cancellation_note}</div>}
          {order.compensation_amount != null && order.compensation_amount > 0 && (
            <div className="cancel-comp">{t('compensationLabel', lang)}: <b>{order.compensation_amount.toFixed(2)} €</b></div>
          )}
        </div>
      )}

      {isOwner && net != null && (
        <div className="summary-box">
          <div className="route">{order.pickup_address} → {order.delivery_address}</div>
          <div className="summary-grid">
            <div>{t('kmLabel', lang)}<b>{order.km ? `${order.km} km` : '—'}</b></div>
            <div>{t('priceLabel', lang)}<b>{net.toFixed(2)} €</b></div>
          </div>
        </div>
      )}

      {companyName && (
        <div className="info-card">
          <div className="info-card-head">🏢 {companyName}</div>
        </div>
      )}

      <GoogleLiveMap pickupCoords={pickupCoords} deliveryCoords={deliveryCoords} stopCoords={puncteOpriri} />

      {order.status !== 'cancelled' && (
        <div className="timeline">
          {/* Toate etapele turului, nu doar cele două capete. Până acum
              dus-întorsul îşi pierdea dovezile de la retur chiar aici. */}
          {tourLegSequence(order).map((e) => (
            <TimelineLeg key={e.key} entry={e} order={order} lang={lang} />
          ))}
        </div>
      )}
    </div>
  )
}

// Ce rânduri de șofer „aparțin" contului conectat.
//
// O firmă parteneră intră în aplicație cu un singur cont — al firmei — dar
// poate atribui o cursă unuia dintre angajații ei. Angajatul are propriul
// rând în tabela de șoferi, adesea fără cont propriu.
//
// Aplicația cerea strict comenzile rândului cu care te-ai autentificat, deci
// o comandă dată unui angajat nu apărea NIMĂNUI: nici angajatului, care n-are
// cont, nici firmei, care e alt rând. Regulile din baza de date permiteau
// deja accesul firmei la comenzile șoferilor ei — doar interogarea era prea
// îngustă.
//
// Pentru un șofer angajat, cu cont propriu, întoarce doar id-ul lui.
function useOwnDriverIds(session, profile) {
  const [ids, setIds] = useState(null)

  useEffect(() => {
    if (!profile?.id) { setIds(null); return }
    let active = true
    // Contul firmei are company_id egal cu propriul cont de autentificare.
    const isCompanyAccount = profile.company_id && session?.user?.id && profile.company_id === session.user.id
    if (!isCompanyAccount) { setIds([profile.id]); return }

    supabase
      .from('drivers')
      .select('id')
      .eq('company_id', profile.company_id)
      .then(({ data, error }) => {
        if (!active) return
        if (error) { console.error('company drivers fetch error:', error.message); setIds([profile.id]); return }
        const list = (data || []).map((d) => d.id)
        setIds(list.length ? list : [profile.id])
      })
    return () => { active = false }
  }, [profile?.id, profile?.company_id, session?.user?.id])

  return ids
}

function useCompanyProfileId(session, profile) {
  const [id, setId] = useState(profile?.company_id || null)
  useEffect(() => {
    if (profile?.company_id) { setId(profile.company_id); return }
    if (!session?.user?.email) return
    supabase
      .rpc('get_courier_profile_id')
      .then(({ data }) => setId(data || null))
  }, [profile?.company_id, session?.user?.email])
  return id
}

function useCourierBids(courierProfileId) {
  const [bids, setBids] = useState([])
  const [loading, setLoading] = useState(true)
  // Numele canalului trebuie să fie unic per instanță — acest hook rulează
  // acum simultan din mai multe locuri (meniu + ecranul propriu-zis), iar
  // Supabase Realtime interzice atașarea de listeneri noi pe un canal cu
  // același nume, deja abonat în altă parte.
  const channelNameRef = useRef(`courier-own-bids-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    if (!courierProfileId) { setLoading(false); return }
    let active = true

    // Îmbinarea `orders(...)` trecea şi ea prin drepturile de citire, deci
    // pentru o ofertă pusă pe o comandă ÎNCĂ DESCHISĂ venea `orders: null` —
    // şi atunci "Meine Angebote" nu mai număra nicio ofertă în aşteptare.
    // Comanda se ia acum din acelaşi loc ca restul ecranelor şi se lipeşte
    // lângă ofertă, cu aceeaşi formă ca înainte.
    function load() {
      Promise.all([
        supabase.from('bids').select('*').eq('courier_id', courierProfileId),
        comenzileFirmei(),
      ]).then(([bidsRes, comenzi]) => {
        if (!active) return
        if (bidsRes.error) console.error('bids fetch error:', bidsRes.error.message)
        const dupaId = new Map((comenzi || []).map((o) => [o.id, o]))
        setBids((bidsRes.data || []).map((b) => ({ ...b, orders: dupaId.get(b.order_id) || null })))
        setLoading(false)
      })
    }

    load()

    const channel = supabase
      .channel(channelNameRef.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids', filter: `courier_id=eq.${courierProfileId}` }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, load)
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
  }, [courierProfileId])

  return { bids, loading }
}

function AssignDriverCard({ order, lang, companyDrivers, onAssigned }) {
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)

  async function assign() {
    if (!selected) return
    setSaving(true)
    // Atribuirea trece prin funcţia din bază, nu printr-un UPDATE direct.
    // Un UPDATE cu `.eq('id', ...)` are nevoie şi de drept de CITIRE pe rândul
    // acela — pe care firma nu-l mai are — iar PostgREST răspunde 204 şi când
    // n-a schimbat nimic. Butonul ar fi arătat verde fără să fi atribuit pe
    // nimeni. Funcţia verifică şi câştigătorul, şi că şoferul e al firmei, şi
    // aruncă o eroare adevărată la refuz.
    const { error } = await supabase.rpc('courier_assign_driver', {
      p_order_id: order.id,
      p_driver_id: selected,
    })
    setSaving(false)
    if (error) {
      console.error('assign driver error:', error.message)
      alert(error.message)
      return
    }
    onAssigned()
  }

  return (
    <div className="bid-card2 open">
      <div className="bid-body-inner" style={{ paddingTop: 16 }}>
        <div className="bid-order-id">{t('orderRef', lang)} {order.order_number || order.id.slice(0, 8)}</div>
        <div className="bid-stop"><span className="addr"><MapPin size={13} strokeWidth={1.8} /> {order.pickup_address}</span></div>
        {/* Cel mult trei rânduri. La douăzeci de opriri, cardul creştea la o
            mie de pixeli — o listă în care nu mai puteai compara două comenzi,
            iar butonul de la bază ieşea de pe ecran. Lista întreagă e pe
            ecranul comenzii, unde îi e locul.
            Fără opacitate pe rând: stingea şi bifa, singurul lucru pentru care
            se citesc rândurile astea. */}
        {tourStops(order).slice(0, 3).map((st) => (
          <div className="bid-stop" key={st.id}>
            <span className="addr" style={{ paddingLeft: 12, color: 'var(--text-soft)', minWidth: 0 }}>
              {st.kind === 'delivery'
                ? <FlagTriangleRight size={12} strokeWidth={1.8} />
                : <MapPin size={12} strokeWidth={1.8} />}
              {' '}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.address}</span>
              {(st.confirmed_at || st.failed_at) && (
                <span style={{ marginLeft: 6, color: st.failed_at ? '#B23A24' : '#1F7A50', fontWeight: 700, flex: '0 0 auto' }}>
                  {st.failed_at ? '✕' : '✓'}
                </span>
              )}
            </span>
          </div>
        ))}
        {tourStops(order).length > 3 && (
          <div className="bid-stop">
            <span className="addr" style={{ paddingLeft: 12, color: 'var(--text-soft)' }}>
              + {tourStops(order).length - 3} {t('stopsMoreLabel', lang)}
            </span>
          </div>
        )}
        <div className="bid-stop"><span className="addr"><FlagTriangleRight size={13} strokeWidth={1.8} /> {order.delivery_address}</span></div>
        <label className="bid-field-label">{t('assignDriverLabel', lang)}</label>
        <select className="doc-type-select" style={{ marginBottom: 10 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— {t('defaultDriverNone', lang)} —</option>
          {companyDrivers.map((d) => (
            <option key={d.id} value={d.id}>{d.name}{d.plate ? ` · ${d.plate}` : ''}</option>
          ))}
        </select>
        <button className="submit-bid-btn" disabled={!selected || saving} onClick={assign}>
          {saving ? '…' : t('assignDriverButton', lang)}
        </button>
      </div>
    </div>
  )
}

function MeineAngeboteScreen({ profile, session, lang }) {
  const courierProfileId = session?.user?.id || null
  const { bids, loading } = useCourierBids(courierProfileId)
  const [companyDrivers, setCompanyDrivers] = useState([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [openBidId, setOpenBidId] = useState(null)

  useEffect(() => {
    if (!courierProfileId) return
    supabase
      .from('drivers')
      .select('id, name, plate, active')
      .eq('company_id', courierProfileId)
      .then(({ data }) => setCompanyDrivers((data || []).filter((d) => d.active !== false)))
  }, [courierProfileId, refreshKey])

  if (loading) return <PlaceholderScreen title={t('menuOffers', lang)} note={t('loadingRides', lang)} />

  const pending = bids.filter((b) => b.orders && b.orders.status === 'open')
  const needsAssignment = bids.filter(
    (b) => b.orders && b.orders.status === 'assigned' && b.orders.winner_bid_id === b.id && !b.orders.assigned_driver_id
  )

  if (pending.length === 0 && needsAssignment.length === 0) {
    return <PlaceholderScreen title={t('menuOffers', lang)} note={t('noOffersPending', lang)} />
  }

  return (
    <div className="rides-list">
      <h2 className="screen-title">{t('menuOffers', lang)}</h2>

      {needsAssignment.length > 0 && (
        <>
          <div className="section-heading">{t('needsAssignmentHeading', lang)} <span className="count-pill">{needsAssignment.length}</span></div>
          {needsAssignment.map((b) => (
            <AssignDriverCard key={b.id} order={b.orders} lang={lang} companyDrivers={companyDrivers} onAssigned={() => setRefreshKey((k) => k + 1)} />
          ))}
        </>
      )}

      {pending.length > 0 && (
        <>
          {needsAssignment.length > 0 && <div className="section-heading">{t('menuOffers', lang)}</div>}
          {pending.map((b) => (
            <BidCard key={b.id} order={b.orders} lang={lang} courierProfileId={courierProfileId} open={openBidId === b.id} onToggle={() => setOpenBidId(openBidId === b.id ? null : b.id)} />
          ))}
        </>
      )}
    </div>
  )
}

function NichtAngenommenScreen({ profile, session, lang }) {
  const courierProfileId = session?.user?.id || null
  const { bids, loading } = useCourierBids(courierProfileId)

  if (loading) return <PlaceholderScreen title={t('menuNotAccepted', lang)} note={t('loadingRides', lang)} />

  const lost = bids.filter((b) => b.orders && b.orders.status !== 'open' && b.orders.winner_bid_id !== b.id)

  if (lost.length === 0) {
    return <PlaceholderScreen title={t('menuNotAccepted', lang)} note={t('noLostBids', lang)} />
  }

  return (
    <div className="rides-list">
      <h2 className="screen-title">{t('menuNotAccepted', lang)}</h2>
      {lost.map((b) => (
        <div className="hist-item" key={b.id} style={{ opacity: 0.75, cursor: 'default' }}>
          <div>
            <div className="id">{b.orders.order_number || b.orders.id.slice(0, 8)}</div>
            {b.orders.pickup_address} → {b.orders.delivery_address}
          </div>
          <div className="p" style={{ color: 'var(--text-soft)' }}>{b.price} €</div>
        </div>
      ))}
    </div>
  )
}

function isToday(dateStr) {
  if (!dateStr) return false
  const today = new Date().toISOString().slice(0, 10)
  return dateStr === today
}

function isTomorrow(dateStr) {
  if (!dateStr) return false
  const t = new Date()
  t.setDate(t.getDate() + 1)
  return dateStr === t.toISOString().slice(0, 10)
}

function isRecentlyNew(createdAtIso) {
  if (!createdAtIso) return false
  const ageMs = Date.now() - new Date(createdAtIso).getTime()
  return ageMs < 2 * 60 * 60 * 1000 // 2 hours
}

// order.notes is built line-by-line by disponent (buildOrderNotesFromRequest);
// each line has a known prefix. Some are internal/billing (never shown to a driver),
// the rest are genuine client instructions the driver should see.
const NOTES_HIDDEN_PREFIXES = ['— Von Kundenanfrage', 'Rechnung:', 'Weitere Benachrichtigung:', 'Warenempfänger informieren:']
function driverSafeNotes(notesText) {
  if (!notesText) return ''
  return notesText
    .split('\n')
    .filter((line) => !NOTES_HIDDEN_PREFIXES.some((p) => line.startsWith(p)))
    .join('\n')
    .trim()
}

function extractContact(notesText, prefix) {
  if (!notesText) return null
  const line = notesText.split('\n').find((l) => l.startsWith(prefix))
  if (!line) return null
  const value = line.slice(prefix.length).trim()
  return value || null
}

function extractPhone(contactText) {
  if (!contactText) return null
  const match = contactText.match(/(\+?\d[\d\s\-\/()]{5,}\d)/)
  return match ? match[1].replace(/\s+/g, ' ').trim() : null
}

// Înainte de câștigarea licitației, firma vede doar cod poștal + oraș +
// țară (cod ISO scurt) — nu adresa exactă. Adresele vin din Google Places,
// de regulă în formatul "Stradă Nr, PLZ Oraș, Țară".
const COUNTRY_CODES = {
  'Deutschland': 'DE', 'Germany': 'DE',
  'Österreich': 'AT', 'Austria': 'AT',
  'Schweiz': 'CH', 'Switzerland': 'CH', 'Suisse': 'CH',
  'Frankreich': 'FR', 'France': 'FR',
  'Italien': 'IT', 'Italy': 'IT', 'Italia': 'IT',
  'Niederlande': 'NL', 'Netherlands': 'NL',
  'Belgien': 'BE', 'Belgium': 'BE',
  'Polen': 'PL', 'Poland': 'PL',
  'Tschechien': 'CZ', 'Czechia': 'CZ',
}
function cityCountryOnly(address) {
  if (!address) return ''

  // Căutăm CODUL POŞTAL, nu numărăm virgule.
  //
  // Varianta dinainte lua penultima bucată dintre virgule drept oraş. La
  // „Str. 3, 80331 München, Deutschland" ieşea bine, dar la o adresă cu
  // două bucăţi — „Lindberghstrasse 3, 85399 Deutschland" — penultima e
  // chiar strada. Adică exact ce nu trebuie arătat înainte de licitare.
  const bucati = address.split(',').map((x) => x.trim()).filter(Boolean)
  const cuCod = bucati.find((x) => /\b\d{4,5}\b/.test(x))

  if (cuCod) {
    const cod = cuCod.match(/\b\d{4,5}\b/)[0]
    // Ce urmează după cod în aceeaşi bucată e oraşul — dacă nu cumva e
    // numele ţării, caz în care rămâne doar codul.
    let oras = cuCod.slice(cuCod.indexOf(cod) + cod.length).trim()
    const ultima = bucati[bucati.length - 1]
    // Ţara o reţinem ÎNAINTE de a goli oraşul: la „85399 Deutschland",
    // ce urmează după cod e chiar ţara, nu un oraş.
    const tara = COUNTRY_CODES[ultima] || COUNTRY_CODES[oras] || null
    if (COUNTRY_CODES[oras]) oras = ''
    const loc = [cod, oras].filter(Boolean).join(' ')
    return tara ? `${loc} · ${tara}` : loc
  }

  // Adresă fără cod poştal: scoatem tot ce conţine cifre (numărul casei)
  // şi păstrăm restul. Mai bine prea puţin decât adresa întreagă.
  const faraNumere = address.split(/[\s,]+/).filter((w) => w && !/\d/.test(w))
  return faraNumere.join(' ')
}

const SERVICE_BADGE_PREFIXES = [
  { prefix: 'Verladehilfe gebucht', icon: '📦⬆️', key: 'loadHelpBadge' },
  { prefix: 'Entladehilfe gebucht', icon: '📦⬇️', key: 'unloadHelpBadge' },
  { prefix: 'Neutrale Zustellung', icon: '🕶️', key: 'neutralDeliveryBadge' },
]

function extractServiceBadges(notesText) {
  if (!notesText) return []
  const lines = notesText.split('\n')
  const badges = SERVICE_BADGE_PREFIXES.filter(({ prefix }) => lines.some((l) => l.startsWith(prefix)))
    .map((b) => ({ ...b, text: null, warn: false }))

  for (const line of lines) {
    if (line.startsWith('ADR: ')) badges.push({ icon: '⚠️', key: null, text: line.replace('ADR: ', 'ADR — '), warn: true })
    else if (line.startsWith('Stapelbar: Ja')) badges.push({ icon: '📦', key: null, text: 'Stapelbar', warn: false })
    else if (line.startsWith('Stapelbar: Nein')) badges.push({ icon: '🚫', key: null, text: 'Nicht stapelbar', warn: true })
    else if (line.includes('frühere Abholung')) badges.push({ icon: '💡', key: null, text: 'Frühere Abholung ggf. möglich', warn: false })
    else if (line.includes('frühere Zustellung')) badges.push({ icon: '💡', key: null, text: 'Frühere Zustellung ggf. möglich', warn: false })
  }
  return badges
}

function driverSafeNotesWithoutContacts(notesText) {
  if (!notesText) return ''
  return notesText
    .split('\n')
    .filter((line) =>
      !NOTES_HIDDEN_PREFIXES.some((p) => line.startsWith(p)) &&
      !line.startsWith('Kontakt Abholung:') &&
      !line.startsWith('Kontakt Zustellung:') &&
      !line.startsWith('Notiz Abholung:') &&
      !line.startsWith('Notiz Zustellung:') &&
      !line.startsWith('Auftraggeber (Gast):') &&
      !line.startsWith('ADR: ') &&
      !line.startsWith('Stapelbar: ') &&
      !line.includes('frühere Abholung') &&
      !line.includes('frühere Zustellung') &&
      !SERVICE_BADGE_PREFIXES.some(({ prefix }) => line.startsWith(prefix))
    )
    .join('\n')
    .trim()
}

// Înainte de a câștiga o licitație, firma nu trebuie să vadă deloc datele de
// contact ale clientului sau notele specifice per etapă — doar informația
// logistică generală (ADR, stivuire, ajutor încărcare, referințe) e utilă
// ca să decidă dacă licitează.
const PRE_WIN_HIDDEN_PREFIXES = [
  ...NOTES_HIDDEN_PREFIXES,
  'Kontakt Abholung:',
  'Kontakt Zustellung:',
  'Notiz Abholung:',
  'Notiz Zustellung:',
  'Kundenbemerkung:',
  'Auftraggeber (Gast):',
  'Referenz:',
  'Referenzen:',
  'Referenznummer:',
]
function preWinSafeNotes(notesText) {
  if (!notesText) return ''
  return notesText
    .split('\n')
    .filter((line) =>
      !PRE_WIN_HIDDEN_PREFIXES.some((p) => line.startsWith(p)) &&
      !line.startsWith('ADR: ') &&
      !line.startsWith('Stapelbar: ') &&
      !line.includes('frühere Abholung') &&
      !line.includes('frühere Zustellung') &&
      !SERVICE_BADGE_PREFIXES.some(({ prefix }) => line.startsWith(prefix))
    )
    .join('\n')
    .trim()
}

function formatFlexibleTimeNote(text) {
  if (!text) return null
  const idx = text.indexOf(' - ')
  if (idx === -1) return { main: text, extra: null }
  return { main: text.slice(0, idx).trim(), extra: text.slice(idx + 3).trim() }
}

function LegTime({ order, prefix, lang }) {
  const isFixed = !!order[`${prefix}_fixed`]
  const date = order[`${prefix}_date`]
  if (!date) return null

  if (isFixed) {
    const time = order[`${prefix}_time`]
    return (
      <div className="fixed-time-row">
        <span className="fixed-time-badge">🔒 {t(prefix === 'pickup' ? 'fixedPickupBadge' : 'fixedDeliveryBadge', lang)}</span>
        <span>{fmtDate(date)}{time ? ` · ${fmtTime(time)}` : ''}</span>
      </div>
    )
  }

  const from = order[`${prefix}_from`]
  const to = order[`${prefix}_to`]
  return (
    <div className="info-row-time">
      {fmtDate(date)}{from ? ` · ${fmtTime(from)}` : ''}{to ? `–${fmtTime(to)}` : ''}
    </div>
  )
}

// Ciclul de facturare al firmei: 'weekly' (Luni–Duminică) sau 'per_order'
// (factură după fiecare comandă, termen 30 de zile). La owner-operator contul
// de autentificare ESTE contul firmei, deci profilul propriu e citibil.
function useBillingCycle(enabled) {
  const [cycle, setCycle] = useState(null)
  useEffect(() => {
    if (!enabled) return
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      const uid = data?.session?.user?.id
      if (!uid) return
      supabase.from('profiles').select('billing_cycle').eq('id', uid).maybeSingle()
        .then(({ data: row }) => { if (active) setCycle(row?.billing_cycle || 'per_order') })
    })
    return () => { active = false }
  }, [enabled])
  return cycle
}

// Începutul perioadei în care cade o dată, după ciclul de facturare.
// Săptămânal: lunea. Pe comandă: întâi de lună.
function periodStartFor(dateStr, cycle) {
  if (cycle === 'weekly') return getWeekStart(dateStr)
  const d = new Date(dateStr)
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function periodEndFor(start, cycle) {
  if (cycle === 'weekly') {
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return end
  }
  return new Date(start.getFullYear(), start.getMonth() + 1, 0)
}

function periodLabel(start, cycle, lang) {
  if (cycle === 'weekly') {
    return `${formatDateShort(start)}–${formatDateShort(periodEndFor(start, 'weekly'))}`
  }
  return start.toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE', { month: 'long', year: 'numeric' })
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr)
  const day = d.getDay() // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day // back to Monday
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function formatDateShort(d) {
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
}

// Sumarul de câștiguri din meniu. Folosește EXACT aceleași definiții ca
// EarningsScreen — status 'done', data de referință delivery_confirmed_at sau,
// în lipsa ei, delivery_date, iar valoarea prin earningsAmount. Dacă cele două
// ar diverge, șoferul ar vedea două cifre diferite pentru aceeași lună și
// n-ar mai avea încredere în niciuna.
function useEarningsSummary(profile, enabled, cycle) {
  const [totals, setTotals] = useState(null) // { month, today, monthCount, todayCount }

  useEffect(() => {
    if (!enabled || !profile?.id) return
    let active = true

    const now = new Date()
    // Aceeași perioadă ca ecranul de câștiguri — altfel cardul și ecranul ar
    // arăta două cifre diferite pentru același interval.
    const start = periodStartFor(now.toISOString(), cycle)
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const monthStart = iso(start)

    supabase
      .from('orders')
      .select('id, is_round_trip, client_cancelled, compensation_amount, delivery_confirmed_at, return_delivery_confirmed_at, delivery_date, winning_bid:bids!fk_winner_bid(price)')
      .eq('assigned_driver_id', profile.id)
      .eq('status', 'done')
      .or(`delivery_confirmed_at.gte.${monthStart},return_delivery_confirmed_at.gte.${monthStart},delivery_date.gte.${monthStart}`)
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          console.error('earnings summary error:', error.message)
          setTotals(null)
          return
        }
        const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        let month = 0, today = 0, monthCount = 0, todayCount = 0
        ;(data || []).forEach((o) => {
          const ref = completionRefDate(o)
          if (!ref) return
          const day = String(ref).slice(0, 10)
          if (day < monthStart) return
          const value = earningsAmount(o)
          month += value
          monthCount++
          if (day === todayIso) { today += value; todayCount++ }
        })
        setTotals({ month, today, monthCount, todayCount })
      })

    return () => { active = false }
  }, [enabled, profile?.id, cycle])

  return totals
}

function EarningsMenuCard({ profile, open, lang, onClick }) {
  const cycle = useBillingCycle(open)
  const totals = useEarningsSummary(profile, open && !!cycle, cycle)
  if (!totals || !cycle) return null

  return (
    <div
      onClick={onClick}
      style={{
        margin: '0 12px 10px', padding: '14px 16px', borderRadius: 12,
        background: 'linear-gradient(135deg, #0F2240 0%, #1B3A63 100%)',
        color: '#fff', cursor: 'pointer',
      }}
    >
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9FB3D0' }}>
        {t(cycle === 'weekly' ? 'earningsWeekLabel' : 'earningsMonthLabel', lang)}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15, marginTop: 2 }}>
        {totals.month.toFixed(2)} €
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,.14)', margin: '11px 0 9px' }} />

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9FB3D0' }}>
          {t('earningsTodayLabel', lang)}
        </span>
        <span style={{ fontSize: 17, fontWeight: 700, color: totals.today > 0 ? '#FF9A55' : '#7D90AC' }}>
          {totals.today.toFixed(2)} €
        </span>
      </div>

      <div style={{ fontSize: 11, color: '#7D90AC', marginTop: 6 }}>
        {t('earningsRidesCount', lang).replace('{m}', totals.monthCount).replace('{d}', totals.todayCount)}
      </div>
    </div>
  )
}

function EarningsScreen({ profile, lang }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState(null)
  const cycle = useBillingCycle(true)

  useEffect(() => {
    if (!profile?.id) { setLoading(false); return }
    supabase
      .from('orders')
      .select('*, winning_bid:bids!fk_winner_bid(price), trip_stops(*)')
      .eq('assigned_driver_id', profile.id)
      .eq('status', 'done')
      .then(({ data, error }) => {
        if (error) console.error('earnings fetch error:', error.message)
        setOrders(data || [])
        setLoading(false)
      })
  }, [profile?.id])

  if (loading) return <PlaceholderScreen title={t('tabEarnings', lang)} note={t('loadingRides', lang)} />

  const withDate = orders
    .map((o) => ({ ...o, _refDate: completionRefDate(o) }))
    .filter((o) => o._refDate)

  const currentWeekStart = periodStartFor(new Date().toISOString(), cycle)
  const byWeek = new Map()
  withDate.forEach((o) => {
    const ws = periodStartFor(o._refDate, cycle)
    const key = ws.toISOString()
    if (!byWeek.has(key)) byWeek.set(key, { start: ws, orders: [] })
    byWeek.get(key).orders.push(o)
  })

  const currentKey = currentWeekStart.toISOString()
  const currentWeek = byWeek.get(currentKey) || { start: currentWeekStart, orders: [] }
  const otherWeeks = [...byWeek.entries()]
    .filter(([key]) => key !== currentKey)
    .map(([, v]) => v)
    .sort((a, b) => b.start - a.start)

  const currentTotal = currentWeek.orders.reduce((sum, o) => sum + earningsAmount(o), 0)
  const weekEnd = periodEndFor(currentWeekStart, cycle)

  function openSummary(o) {
    const net = earningsAmount(o)
    setSummary({
      id: o.order_number || o.reference || o.id.slice(0, 8),
      route: `${o.pickup_address} → ${o.delivery_address}`,
      km: o.km,
      net,
    })
  }

  return (
    <div className="rides-list">
      <div className="earn-hero">
        <div className="lbl">{t(cycle === 'weekly' ? 'earningsWeekLabel' : 'earningsMonthPeriodLabel', lang)}</div>
        <div className="amt">{currentTotal.toFixed(2)} €</div>
        <div className="row">
          <div>{t('earningsPeriod', lang)}<b>{periodLabel(currentWeekStart, cycle, lang)}</b></div>
          <div>{t('tabRides', lang)}<b>{currentWeek.orders.length}</b></div>
        </div>
      </div>

      <div className="section-heading">{t(cycle === 'weekly' ? 'earningsThisWeek' : 'earningsThisMonth', lang)} <span className="count-pill">{currentWeek.orders.length}</span></div>
      {currentWeek.orders.length === 0 ? (
        <div className="empty-note">{t('noRides', lang)}</div>
      ) : (
        currentWeek.orders.map((o) => (
          <div className="hist-item" key={o.id} onClick={() => openSummary(o)}>
            <div><div className="id">{o.order_number || o.reference || o.id.slice(0, 8)}</div>{o.pickup_address} → {o.delivery_address}</div>
            <div className="p">{earningsAmount(o).toFixed(2)} €</div>
          </div>
        ))
      )}

      {otherWeeks.length > 0 && (
        <>
          <div className="section-heading">{t(cycle === 'weekly' ? 'earningsPreviousWeeks' : 'earningsPreviousMonths', lang)}</div>
          {otherWeeks.map((w) => {
            const total = w.orders.reduce((sum, o) => sum + earningsAmount(o), 0)
            return (
              <div className="hist-item" key={w.start.toISOString()} style={{ opacity: 0.75 }}>
                <div><div className="id">{periodLabel(w.start, cycle, lang)}</div>{w.orders.length} {t('tabRides', lang)}</div>
                <div className="p">{total.toFixed(2)} €</div>
              </div>
            )
          })}
        </>
      )}

      {summary && (
        <div className="filter-overlay show" onClick={(e) => { if (e.target === e.currentTarget) setSummary(null) }}>
          <div className="filter-panel">
            <h4>{summary.id}</h4>
            <div className="ride-card2-route" style={{ margin: '0 0 14px' }}>{summary.route}</div>
            <div className="info-row"><span className="k">{t('kmLabel', lang)}</span><span className="v">{summary.km ? `${summary.km} km` : '—'}</span></div>
            <div className="info-row"><span className="k">{t('priceLabel', lang)}</span><span className="v price">{summary.net.toFixed(2)} €</span></div>
            <button className="filter-apply" style={{ marginTop: 16 }} onClick={() => setSummary(null)}>{t('back', lang)}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Distanța (km) între 2 puncte, formula Haversine — matematică simplă,
// fără niciun apel de rețea.
// Cât de departe e şoferul de punctul etapei curente, folosit DOAR la
// livrările de documente (Zustellung durch Boten), unde proba contează.
//
// Nu blocăm orbeşte: dacă telefonul nu ştie sigur unde se află — garaj
// subteran, hală, curte interioară — `accuracy` e mare, iar atunci măsura
// e inutilă şi ar ţine şoferul captiv în faţa uşii. În cazul acela lăsăm
// butonul să meargă şi consemnăm că poziţia era nesigură.
const PRAG_METRI = 70

// Siguranţa măsurătorii nu se judecă printr-o limită fixă: aceeaşi marjă
// de eroare înseamnă altceva la 100 de metri faţă de 600. Blocăm doar când
// distanţa e de cel puţin trei ori mai mare decât marja — adică atunci
// când, chiar şi luând în calcul cea mai mare greşeală posibilă a
// telefonului, şoferul tot e departe.
const FACTOR_SIGURANTA = 3

function useDistantaFataDe(target, activ) {
  const [stare, setStare] = useState({ metri: null, sigur: false })

  useEffect(() => {
    if (!activ || !target || !('geolocation' in navigator)) {
      setStare({ metri: null, marja: null, sigur: false })
      return
    }
    let viu = true
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (!viu) return
        const metri = haversineKm(coords.latitude, coords.longitude, target[0], target[1]) * 1000
        const marja = coords.accuracy != null ? coords.accuracy : 9999
        setStare({
          metri: Math.round(metri),
          marja: Math.round(marja),
          // „sigur" = distanţa depăşeşte marja de atâtea ori încât nu mai
          // poate fi o greşeală de măsurare.
          sigur: metri >= marja * FACTOR_SIGURANTA,
        })
      },
      () => { if (viu) setStare({ metri: null, marja: null, sigur: false }) },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    )
    return () => { viu = false; navigator.geolocation.clearWatch(id) }
  }, [activ, target && target[0], target && target[1]])

  // „prea departe" înseamnă: ştim sigur unde suntem ŞI suntem dincolo de prag.
  const preaDeparte = stare.sigur && stare.metri != null && stare.metri > PRAG_METRI
  return { ...stare, preaDeparte }
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Geocodifică o adresă, cu cache simplu în memorie — nu repetăm apeluri
// pentru aceeași adresă de mai multe ori.
const geocodeCache = new Map()

// Trasee deja cerute de la Google, pe durata sesiunii.
const directionsCache = new Map()
async function geocodeAddressCached(address, mapsKey) {
  if (geocodeCache.has(address)) return geocodeCache.get(address)

  // Întâi din telefon, cât timp merge. Dacă nu — şi de obicei nu merge,
  // fiindcă o cheie restricţionată pe domeniu e refuzată de serviciul de
  // geocodare al Google, chiar dacă harta se încarcă — întrebăm serverul,
  // unde cheia nu are restricţii.
  let result = null
  if (mapsKey) {
    try {
      const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${mapsKey}`)
      const data = await res.json()
      const loc = data?.results?.[0]?.geometry?.location
      if (loc) result = { lat: loc.lat, lng: loc.lng }
    } catch { /* trecem pe varianta de server */ }
  }

  if (!result) {
    try {
      const { data, error } = await supabase.functions.invoke('geocode-address', { body: { address } })
      if (!error && data?.lat != null && data?.lng != null) result = { lat: data.lat, lng: data.lng }
      else if (data?.status && data.status !== 'OK') console.warn('geocode server:', data.status)
    } catch (e) {
      console.error('geocode server failed:', e.message)
    }
  }

  geocodeCache.set(address, result)
  return result
}

function useDriverLocation(session) {
  const [position, setPosition] = useState(null) // {lat, lng} | null
  useEffect(() => {
    if (!navigator.geolocation) return

    function capture() {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setPosition(coords)
          if (session?.access_token) {
            supabase.from('profiles').update({ last_lat: coords.lat, last_lng: coords.lng, last_location_at: new Date().toISOString() }).eq('id', session.user.id).then(() => {})
          }
        },
        () => {}, // dacă utilizatorul refuză locația, pur și simplu nu filtrăm — nicio eroare vizibilă
        { enableHighAccuracy: false, timeout: 8000 }
      )
    }

    capture()
    // La fiecare 3 minute, cât timp aplicația rămâne deschisă — dispecerul
    // vede poziția actualizată, nu doar un instantaneu de la deschidere.
    const interval = setInterval(capture, 3 * 60 * 1000)
    return () => clearInterval(interval)
  }, [session?.access_token])
  return position
}

function BiddingScreen({ profile, session, lang, embedded }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [biddedOrderIds, setBiddedOrderIds] = useState(new Set())
  const [radiusKm, setRadiusKm] = useState(null) // null = alle
  const courierProfileId = session?.user?.id || null
  const driverLocation = useDriverLocation(session)
  const mapsKey = useGoogleMapsKey()
  const isOwner = profile?.account_type === 'owner_operator'

  // Încarcă preferința salvată — rămâne aceeași data viitoare când
  // șoferul deschide aplicația, nu se resetează la "Alle".
  useEffect(() => {
    if (!isOwner || !courierProfileId) return
    supabase.from('profiles').select('preferred_radius_km').eq('id', courierProfileId).maybeSingle()
      .then(({ data }) => { if (data?.preferred_radius_km) setRadiusKm(data.preferred_radius_km) })
  }, [isOwner, courierProfileId])

  function updateRadius(value) {
    setRadiusKm(value)
    if (courierProfileId) supabase.from('profiles').update({ preferred_radius_km: value }).eq('id', courierProfileId).then(() => {})
  }

  useEffect(() => {
    let active = true
    const incarcaLicitatiile = () =>
      comenzileFirmei().then((comenzi) => {
        if (!active) return
        // null = interogarea a căzut; lista de pe ecran rămâne cum era.
        if (comenzi) {
          setOrders(
            comenzi
              .filter(esteLaLicitatie)
              .sort((a, b) => String(a.pickup_date || '').localeCompare(String(b.pickup_date || ''))),
          )
        }
        setLoading(false)
      })

    incarcaLicitatiile()

    if (courierProfileId) {
      supabase
        .from('bids')
        .select('order_id')
        .eq('courier_id', courierProfileId)
        .then(({ data }) => setBiddedOrderIds(new Set((data || []).map((b) => b.order_id))))
    }

    const channel = supabase
      .channel('bidding-open-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'status=eq.open' }, () => {
        incarcaLicitatiile()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids', filter: `courier_id=eq.${courierProfileId}` }, () => {
        supabase.from('bids').select('order_id').eq('courier_id', courierProfileId).then(({ data }) => setBiddedOrderIds(new Set((data || []).map((b) => b.order_id))))
      })
      .subscribe()

    // Abonamentul de mai sus nu mai primeşte nimic pentru firme — trece prin
    // drepturile de citire pe `orders`, care nu mai există. Lista se
    // împrospătează singură, şi la revenirea în aplicaţie.
    const ceas = setInterval(incarcaLicitatiile, 25000)
    const laTrezire = () => incarcaLicitatiile()
    window.addEventListener('focus', laTrezire)

    return () => {
      active = false
      clearInterval(ceas)
      window.removeEventListener('focus', laTrezire)
      supabase.removeChannel(channel)
    }
  }, [courierProfileId])

  // odată ce ai licitat, comanda trece exclusiv la "Meine Angebote" — nu mai
  // rămâne și în "Verfügbar"
  const availableOrders = orders.filter((o) => !biddedOrderIds.has(o.id))

  // Calculul de distanță (afișat pe fiecare comandă, "X km bis zu dir")
  // a fost dezactivat complet — atât varianta cu ruta reală, cât și cea
  // "gratuită" foloseau geocodificare Google, plătită la scară mare (multe
  // verificări × mulți șoferi). Sortarea rămâne în ordinea normală.
  const sortedOrders = availableOrders

  if (loading) return <PlaceholderScreen title={embedded ? '' : t('tabBidding', lang)} note={t('loadingRides', lang)} />

  const radiusFilter = isOwner && (
    <div className="radius-filter-row">
      <span className="radius-filter-label">{t('radiusFilterLabel', lang)}</span>
      <select className="doc-type-select" value={radiusKm ?? 'all'} onChange={(e) => updateRadius(e.target.value === 'all' ? null : Number(e.target.value))}>
        <option value="100">100 km</option>
        <option value="200">200 km</option>
        <option value="350">350 km</option>
        <option value="600">600 km</option>
        <option value="all">{t('radiusFilterAll', lang)}</option>
      </select>
    </div>
  )

  if (availableOrders.length === 0) {
    return (
      <div className={embedded ? '' : 'rides-list'}>
        {!embedded && <h2 className="screen-title">{t('tabBidding', lang)}</h2>}
        {radiusFilter}
        <PlaceholderScreen title="" note={t('biddingPlaceholder', lang)} />
      </div>
    )
  }

  return (
    <div className={embedded ? '' : 'rides-list'}>
      {!embedded && <h2 className="screen-title">{t('tabBidding', lang)}</h2>}
      {radiusFilter}
      {sortedOrders.map((o) => (
        <BidCard key={o.id} order={o} lang={lang} courierProfileId={courierProfileId} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? null : o.id)} onBidPlaced={(orderId) => setBiddedOrderIds((prev) => new Set(prev).add(orderId))} />
      ))}
    </div>
  )
}

const SHIPMENT_TYPE_LABELS = {
  dokumente: 'Dokumente',
  pakete: 'Pakete',
  europaletten: 'Europaletten',
  paletten: 'Paletten',
  gitterbox: 'Gitterbox',
  baumaterialien: 'Baumaterialien',
  'lkw-komplett': 'Ganzes Fahrzeug',
  sonstiges: 'Sonstiges',
}

const SHIPMENT_TYPE_SINGULAR = {
  dokumente: 'Dokument',
  pakete: 'Paket',
  europaletten: 'Europalette',
  paletten: 'Palette',
  gitterbox: 'Gitterbox',
  baumaterialien: 'Baumaterial',
  'lkw-komplett': 'Ganzes Fahrzeug',
  sonstiges: 'Sonstiges',
}

// Rezumatul mărfii, pe tipuri.
//
// Câmpul shipment_type e unul singur și reține doar primul tip al comenzii.
// Afișat împreună cu cantitatea totală, producea „Paletten (8×)" pentru o
// comandă care are de fapt 1 palet, 2 europaleți și 5 pachete — adică firma
// care licitează vedea opt paleți și calcula greșit vehiculul și prețul.
//
// Detaliile reale sunt în cargo_items. Le grupăm pe tip și le însumăm,
// fiindcă aceeași categorie poate apărea pe mai multe rânduri.
function cargoSummary(order) {
  const items = Array.isArray(order?.cargo_items) ? order.cargo_items : []
  const valid = items.filter((it) => it && it.type && Number(it.qty) > 0)
  if (valid.length === 0) {
    if (!order?.shipment_type) return null
    const label = SHIPMENT_TYPE_LABELS[order.shipment_type] || order.shipment_type
    return order.quantity ? `${label} (${order.quantity}×)` : label
  }
  const byType = new Map()
  valid.forEach((it) => byType.set(it.type, (byType.get(it.type) || 0) + Number(it.qty)))
  return [...byType.entries()]
    .map(([type, qty]) => {
      const label = qty === 1
        ? (SHIPMENT_TYPE_SINGULAR[type] || SHIPMENT_TYPE_LABELS[type] || type)
        : (SHIPMENT_TYPE_LABELS[type] || type)
      return `${qty}× ${label}`
    })
    .join(' · ')
}

function VehicleChips({ vehicles }) {
  if (!vehicles || vehicles.length === 0) return null
  return (
    <div className="veh-chips">
      {vehicles.map((v, i) => (
        <span className="veh-chip" key={i}>
          <Truck size={13} strokeWidth={1.8} /> {v.charAt(0).toUpperCase() + v.slice(1)}
        </span>
      ))}
    </div>
  )
}

function BidCard({ order, lang, courierProfileId, open, onToggle, onBidPlaced }) {
  const [ownPrice, setOwnPrice] = useState('')
  const [message, setMessage] = useState('')
  const [respectInterval, setRespectInterval] = useState(true)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [existingBid, setExistingBid] = useState(null)
  const [bidError, setBidError] = useState('')
  const [editing, setEditing] = useState(false)
  const today = isToday(order.pickup_date)
  const tomorrow = isTomorrow(order.pickup_date)

  useEffect(() => {
    if (!courierProfileId) return
    supabase
      .from('bids')
      .select('*')
      .eq('order_id', order.id)
      .eq('courier_id', courierProfileId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setExistingBid(data)
          setOwnPrice(String(data.price ?? ''))
          setMessage(data.message || '')
        }
      })
  }, [courierProfileId, order.id])

  // Contraoferta dispecerului.
  //
  // Până acum exista doar în portalul de partener, pe calculator. Un
  // owner-operator care lucrează de pe telefon primea emailul cu prețul
  // propus și nu putea face nimic în aplicație — trebuia să deschidă
  // portalul sau să sune dispeceratul.
  //
  // Acceptarea schimbă doar prețul ofertei lui. NU atribuie comanda:
  // alegerea câștigătorului rămâne o decizie separată a dispecerului.
  async function acceptCounter() {
    if (!existingBid?.counter_price) return
    setBusy(true)
    try {
      const history = Array.isArray(existingBid.price_history) ? existingBid.price_history : []
      const { data, error } = await supabase
        .from('bids')
        .update({
          price: existingBid.counter_price,
          price_history: [...history, { price: existingBid.price, at: new Date().toISOString(), by: 'courier' }],
          counter_price: null,
          counter_message: null,
          counter_at: null,
          counter_rejected_at: null,
        })
        .eq('id', existingBid.id)
        .select()
        .single()
      if (error) throw error
      setExistingBid(data)
      setOwnPrice(String(data.price ?? ''))
    } catch (err) {
      console.error('accept counter error:', err.message)
      setBidError(t('counterFailed', lang))
    }
    setBusy(false)
  }

  // Refuzul lasă oferta inițială neatinsă și îl marchează pentru dispecer.
  // Contraoferta dispare de pe ecranul șoferului, iar el poate trimite un
  // preț nou — momentul în care marcajul de refuz se șterge automat.
  async function rejectCounter() {
    if (!existingBid?.counter_price) return
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('bids')
        .update({ counter_rejected_at: new Date().toISOString() })
        .eq('id', existingBid.id)
        .select()
        .single()
      if (error) throw error
      setExistingBid(data)
      setEditing(true)
    } catch (err) {
      console.error('reject counter error:', err.message)
      setBidError(t('counterFailed', lang))
    }
    setBusy(false)
  }

  async function submitBid(amount) {
    if (!courierProfileId) {
      console.error('bid submit error: no courier profile id resolved yet')
      return
    }
    setBusy(true)
    try {
      const etaFrom = respectInterval ? order.pickup_from : (customFrom || null)
      const etaTo = respectInterval ? order.pickup_to : (customTo || null)

      if (existingBid) {
        const { data, error } = await supabase
          .from('bids')
          // Un preț nou încheie negocierea în curs: contraoferta veche și
          // marcajul de refuz nu mai au ce căuta pe ofertă.
          .update({
            price: amount, message: message || null, eta_from: etaFrom, eta_to: etaTo,
            counter_price: null, counter_message: null, counter_at: null, counter_rejected_at: null,
          })
          .eq('id', existingBid.id)
          .select()
          .single()
        if (error) throw error
        setExistingBid(data)
      } else {
        const { data, error } = await supabase
          .from('bids')
          .insert({
            order_id: order.id,
            courier_id: courierProfileId,
            price: amount,
            message: message || null,
            eta_from: etaFrom,
            eta_to: etaTo,
          })
          .select()
          .single()
        if (error) throw error
        setExistingBid(data)
        if (onBidPlaced) onBidPlaced(order.id)
      }
      setEditing(false)
    } catch (err) {
      console.error('bid submit error:', err.message)
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function withdrawBid() {
    if (!existingBid) return
    setBusy(true)
    try {
      const { error } = await supabase.from('bids').delete().eq('id', existingBid.id)
      if (error) throw error
      setExistingBid(null)
      setOwnPrice('')
      setMessage('')
    } catch (err) {
      console.error('bid withdraw error:', err.message)
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`bid-card2 ${open ? 'open' : ''}`}>
      <div className="bid-card2-head" onClick={onToggle}>
        {isRecentlyNew(order.created_at) && <span className="new-corner">{t('newBadge', lang)}</span>}
        <div className="bid-top-row">
          <div className="bid-top-left">
            <span className="pill-label">{t('pickup', lang)}</span>
            <span className="pill-date">{fmtDate(order.pickup_date)}</span>
            <span className="pill-time">{order.pickup_fixed ? (order.pickup_time ? `🔒 ${fmtTime(order.pickup_time)}${order.pickup_to ? `–${fmtTime(order.pickup_to)}` : ''}` : '🔒') : (order.pickup_from ? `${fmtTime(order.pickup_from)}${order.pickup_to ? `–${fmtTime(order.pickup_to)}` : ''}` : '—')}</span>
            {order.is_shuttle && <span className="pill" style={{ background: '#EAF0FB', color: '#2A5299' }}>🚐 Shuttle</span>}
          </div>
          <div className="bid-top-right">
            {today && <span className="pill heute">{t('todayBadge', lang)}</span>}
            {!today && tomorrow && <span className="pill morgen">{t('tomorrowBadge', lang)}</span>}
          </div>
        </div>
        <div className="bid-order-mini">{t('orderRef', lang)} {order.order_number || order.id.slice(0, 8)}</div>
        {existingBid && (
          <div className="geboten-row">
            <span className="pill geboten">✓ {t('bidPlaced', lang)}: {existingBid.price} €</span>
          </div>
        )}
        <div className="bid-stop"><span className="addr"><MapPin size={13} strokeWidth={1.8} /> {cityCountryOnly(order.pickup_address)}</span></div>
        <div className="bid-stop"><span className="addr"><FlagTriangleRight size={13} strokeWidth={1.8} /> {cityCountryOnly(order.delivery_address)}</span>{order.km != null && <span className="val">📍 {order.km} km</span>}</div>

        {/* Orele alternative, acolo unde se hotărăște prețul.
            Erau afișate doar în cursa deja atribuită — dar firma trebuie să
            le vadă ÎNAINTE de a licita: o ridicare la 15:00 în loc de 11:37
            schimbă dacă o cursă merită sau nu. */}
        {(order.pickup_alt_date || order.delivery_alt_date) && (
          <div style={{ background: '#FFF6ED', border: '1px solid #FF7A29', borderRadius: 6,
                        padding: '6px 10px', marginTop: 6, fontSize: 12.5, color: '#E86317', lineHeight: 1.6 }}>
            {order.pickup_alt_date && (
              <div>
                ⏰ {t('altPickupLabel', lang)}: {fmtDate(order.pickup_alt_date)}
                {order.pickup_alt_from ? ` ${fmtTime(order.pickup_alt_from)}${order.pickup_alt_to ? `–${fmtTime(order.pickup_alt_to)}` : ''}` : ''}
              </div>
            )}
            {order.delivery_alt_date && (
              <div>
                ⏰ {t('altDeliveryLabel', lang)}: {fmtDate(order.delivery_alt_date)}
                {order.delivery_alt_from ? ` ${fmtTime(order.delivery_alt_from)}${order.delivery_alt_to ? `–${fmtTime(order.delivery_alt_to)}` : ''}` : ''}
              </div>
            )}
          </div>
        )}

        <div className="bid-divider" />
        <div className="bid-zustellung-label">{t('delivery', lang)}</div>
        <div className="bid-zustellung-val">
          {order.delivery_fixed ? (
            <span className="fixed-time-badge">🔒 {t('fixedDeliveryBadge', lang)} · {fmtDate(order.delivery_date)}{order.delivery_time ? ` · ${fmtTime(order.delivery_time)}` : ''}</span>
          ) : (
            <>{fmtDate(order.delivery_date)} · {fmtTime(order.delivery_from)}{order.delivery_to ? `–${fmtTime(order.delivery_to)}` : ''}</>
          )}
        </div>

        <div className="bid-cargo-row">
          <VehicleChips vehicles={order.vehicles} />
          <div className="bid-cargo-meta">
            {order.weight && <span className="meta-item">⚖ {order.weight} kg</span>}
          </div>
        </div>
      </div>

      <div className="bid-card2-body">
        <div className="bid-body-inner">
          {cargoSummary(order) && (
            <div className="shipment-type-row">
              📦 {cargoSummary(order)}
            </div>
          )}
          {order.dims && (
            <div className="bid-extra-row">📐 {order.dims} cm</div>
          )}

          {extractServiceBadges(order.notes).length > 0 && (
            <div className="service-badges">
              {extractServiceBadges(order.notes).map((b, i) => (
                <span key={b.key || i} className={`service-badge${b.warn ? ' warn' : ''}`}>{b.icon} {b.key ? t(b.key, lang) : b.text}</span>
              ))}
            </div>
          )}

          {order.flexible_time_notes && (
            <div className="flex-time-note">
              ⏱ {formatFlexibleTimeNote(order.flexible_time_notes).main}
            </div>
          )}

          {order.notes && preWinSafeNotes(order.notes) && (
            <div className="order-notes-box">
              <div className="order-notes-label">{t('notesLabel', lang)}</div>
              <div className="order-notes-text">{preWinSafeNotes(order.notes)}</div>
            </div>
          )}

          {existingBid?.counter_price && !existingBid.counter_rejected_at && (
            <div style={{
              background: '#FFF6ED', border: '1px solid #FFD2AE', borderRadius: 10,
              padding: '14px 15px', marginBottom: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#B35A12', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {t('counterTitle', lang)}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '6px 0 2px' }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: '#B35A12' }}>{existingBid.counter_price} €</span>
                <span style={{ fontSize: 12.5, color: '#8A5A16', textDecoration: 'line-through' }}>{existingBid.price} €</span>
              </div>
              {existingBid.counter_message && (
                <div style={{ fontSize: 13, color: '#8A5A16', lineHeight: 1.5, marginTop: 6 }}>
                  „{existingBid.counter_message}"
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn" style={{ flex: 1, marginTop: 0 }} onClick={acceptCounter} disabled={busy}>
                  {t('counterAccept', lang)}
                </button>
                <button className="btn secondary" style={{ flex: 1, marginTop: 0 }} onClick={rejectCounter} disabled={busy}>
                  {t('counterReject', lang)}
                </button>
              </div>
            </div>
          )}

          {existingBid?.counter_rejected_at && (
            <div style={{
              background: '#F6F8FA', border: '1px solid #D8DEE8', borderRadius: 10,
              padding: '10px 13px', marginBottom: 12, fontSize: 12.5, color: '#6B7A90', lineHeight: 1.5,
            }}>
              {t('counterRejectedNote', lang)}
            </div>
          )}

          {bidError && (
            <div style={{
              background: '#FCEBE8', border: '1px solid #E4A296', borderRadius: 10,
              padding: '10px 12px', marginBottom: 12, fontSize: 13, color: '#B23A24',
            }}>
              {bidError}
            </div>
          )}

          {existingBid && !editing ? (
            <div className="existing-bid-box">
              <div className="existing-bid-price">{existingBid.price} €</div>
              <div className="existing-bid-actions">
                <button className="btn secondary" onClick={(e) => { e.stopPropagation(); setEditing(true) }}>{t('editBid', lang)}</button>
                <button className="btn danger" onClick={(e) => { e.stopPropagation(); withdrawBid() }} disabled={busy}>{t('withdrawBid', lang)}</button>
              </div>
            </div>
          ) : (
            <>
              {order.estimated_price != null && (
                <div className="price-box">
                  <div><div className="lbl">{t('priceLabel', lang)}</div><div className="val">{order.estimated_price} €</div></div>
                  <button className="accept-btn" onClick={(e) => { e.stopPropagation(); submitBid(order.estimated_price) }} disabled={busy}>✓</button>
                </div>
              )}

              <div className="or-own">{t('orOwnOffer', lang)}</div>
              <label className="bid-field-label">{t('priceLabel', lang)} (€)</label>
              <input className="bid-input2" type="number" value={ownPrice} onChange={(e) => setOwnPrice(e.target.value)} />

              {today && (
                <div className="interval-note">
                  <div className="txt">{t('pickupWindowNote', lang)}: {fmtTime(order.pickup_from)}{order.pickup_to ? `–${fmtTime(order.pickup_to)}` : ''}</div>
                  <label>
                    <input type="checkbox" checked={respectInterval} onChange={(e) => setRespectInterval(e.target.checked)} />
                    {' '}{t('canRespectInterval', lang)}
                  </label>
                  {!respectInterval && (
                    <div className="custom-interval-row">
                      <input className="bid-input2" type="time" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} placeholder={t('fromLabel', lang)} />
                      <input className="bid-input2" type="time" value={customTo} onChange={(e) => setCustomTo(e.target.value)} placeholder={t('toLabel', lang)} />
                    </div>
                  )}
                </div>
              )}

              <textarea className="bid-input2" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('messageToDispatcher', lang)} />

              <button
                className="submit-bid-btn"
                disabled={busy || !ownPrice || !courierProfileId}
                onClick={(e) => { e.stopPropagation(); submitBid(parseFloat(ownPrice)) }}
              >
                {busy ? '…' : t('submitBid', lang)}
              </button>
            </>
          )}

          <div className="bid-footnote">{t('bidFootnote', lang)}</div>
        </div>
      </div>
    </div>
  )
}

function ProfileScreen({ session, profile, isOwner, lang, onChangeLang, onProfileChange }) {
  const [busy, setBusy] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInputRef = useRef(null)
  const isOnline = !!profile?.is_online
  const companyProfileId = useCompanyProfileId(session, profile)
  const [vehicles, setVehicles] = useState([])
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [companyDrivers, setCompanyDrivers] = useState([])
  const [autoAssignEnabled, setAutoAssignEnabled] = useState(true)
  const [savingAssignPrefs, setSavingAssignPrefs] = useState(false)
  // Numărul de telefon al şoferului. Firma îl completează la înregistrare,
  // dar adesea îl lasă gol sau se schimbă între timp — iar dispeceratul
  // rămâne fără cale de a-l suna când ceva se blochează la faţa locului.
  const [telefon, setTelefon] = useState(profile?.phone || '')
  const [telefonStare, setTelefonStare] = useState(null)

  async function salveazaTelefon() {
    setTelefonStare({ busy: true })
    const { error } = await supabase.from('drivers')
      .update({ phone: telefon.trim() || null })
      .eq('id', profile.id)
    if (error) {
      setTelefonStare({ ok: false, msg: error.message })
    } else {
      setTelefonStare({ ok: true, msg: t('phoneSaved', lang) })
      if (onProfileChange) onProfileChange({ ...profile, phone: telefon.trim() || null })
      setTimeout(() => setTelefonStare(null), 2500)
    }
  }

  const [pushStatus, setPushStatus] = useState('checking') // 'checking' | 'unsupported' | 'subscribed' | 'unsubscribed'
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')

  useEffect(() => {
    getPushSubscriptionStatus().then(setPushStatus).catch(() => setPushStatus('unsupported'))
  }, [])

  async function togglePush() {
    if (!profile?.id) return
    setPushBusy(true)
    setPushError('')
    try {
      if (pushStatus === 'subscribed') {
        await unsubscribePush(profile.id)
        setPushStatus('unsubscribed')
      } else {
        await subscribePush(profile.id)
        setPushStatus('subscribed')
      }
    } catch (err) {
      setPushError(err.message)
    } finally {
      setPushBusy(false)
    }
  }

  useEffect(() => {
    if (!companyProfileId) return
    supabase
      .from('vehicles')
      .select('*')
      .eq('company_id', companyProfileId)
      .then(({ data, error }) => {
        if (error) console.error('vehicles fetch error:', error.message)
        setVehicles(data || [])
      })
  }, [companyProfileId])

  useEffect(() => {
    if (!companyProfileId || !isOwner) return
    supabase
      .from('drivers')
      .select('id, name, plate, active')
      .eq('company_id', companyProfileId)
      .then(({ data, error }) => {
        if (error) console.error('company drivers fetch error:', error.message)
        setCompanyDrivers((data || []).filter((d) => d.active !== false))
      })
    supabase
      .from('profiles')
      .select('auto_assign_enabled')
      .eq('id', companyProfileId)
      .single()
      .then(({ data }) => {
        if (data) setAutoAssignEnabled(data.auto_assign_enabled !== false)
      })
  }, [companyProfileId, isOwner])

  async function saveAssignPrefs(patch) {
    if (!companyProfileId) return
    setSavingAssignPrefs(true)
    const { error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', companyProfileId)
    setSavingAssignPrefs(false)
    if (error) console.error('assign prefs save error:', error.message)
  }

  async function selectVehicle(vehicleId) {
    if (!profile?.id) return
    setSavingVehicle(true)
    const { error } = await supabase
      .from('drivers')
      .update({ vehicle_id: vehicleId || null })
      .eq('id', profile.id)
    setSavingVehicle(false)
    if (error) {
      console.error('vehicle select error:', error.message)
      return
    }
    onProfileChange()
  }

  async function toggleOnline() {
    if (!profile?.id) return
    setBusy(true)
    const { error } = await supabase
      .from('drivers')
      .update({ is_online: !isOnline })
      .eq('id', profile.id)
    setBusy(false)
    if (error) {
      console.error('toggle online error:', error.message)
      return
    }
    onProfileChange()
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0]
    if (!file || !profile?.id) return
    setUploadingPhoto(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${profile.id}/profile.${ext}`
      const { error: upErr } = await supabase.storage
        .from('driver-photos')
        .upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('driver-photos').getPublicUrl(path)
      const { error: dbErr } = await supabase
        .from('drivers')
        .update({ photo_url: data.publicUrl })
        .eq('id', profile.id)
      if (dbErr) throw dbErr
      onProfileChange()
    } catch (err) {
      console.error('photo upload error:', err.message)
    } finally {
      setUploadingPhoto(false)
      e.target.value = ''
    }
  }

  return (
    <div className="placeholder-screen">
      <h2>{t('tabProfile', lang)}</h2>

      <LangSwitcher lang={lang} onChangeLang={onChangeLang} />

      <div className="profile-photo-row">
        {profile?.photo_url ? (
          <img src={profile.photo_url} alt="" className="profile-photo" onClick={() => photoInputRef.current?.click()} />
        ) : (
          <div className="profile-photo-placeholder" onClick={() => photoInputRef.current?.click()}>
            {uploadingPhoto ? '…' : '+'}
          </div>
        )}
        <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadPhoto} />
        <button className="profile-photo-btn" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>
          {uploadingPhoto ? '…' : t('changePhoto', lang)}
        </button>
      </div>

      <p>
        {t('accountLabel', lang)}: {profile?.name || session.user.email} · {t('typeLabel', lang)}:{' '}
        {isOwner ? t('typeOwnerOperator', lang) : t('typeEmployee', lang)}
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-soft)', marginTop: -8 }}>
        📧 {session.user.email}
      </p>

      <div style={{ margin: '10px 0 14px' }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-soft)', display: 'block', marginBottom: 5 }}>
          📞 {t('phoneLabel', lang)}
        </label>
        <div style={{ display: 'flex', gap: 7 }}>
          <input
            className="bid-input2"
            type="tel"
            inputMode="tel"
            value={telefon}
            onChange={(e) => setTelefon(e.target.value)}
            placeholder="+49 …"
            style={{ flex: 1, margin: 0 }}
          />
          <button
            className="btn"
            onClick={salveazaTelefon}
            disabled={telefonStare?.busy || (telefon || '') === (profile?.phone || '')}
            style={{ width: 'auto', padding: '0 16px' }}
          >
            {telefonStare?.busy ? '…' : t('saveLabel', lang)}
          </button>
        </div>
        {telefonStare && !telefonStare.busy && (
          <div style={{ fontSize: 11.5, marginTop: 4, color: telefonStare.ok ? '#1B6E43' : '#B23A24' }}>
            {telefonStare.msg}
          </div>
        )}
      </div>

      <div className="toggle-row">
        <div className="txt">
          {t('onlineToggle', lang)}
          <small>{t('onlineToggleNote', lang)}</small>
        </div>
        <button
          className={`switch ${isOnline ? 'on' : ''}`}
          onClick={toggleOnline}
          disabled={busy}
        />
      </div>

      {pushStatus !== 'unsupported' && pushStatus !== 'checking' && (
        <div className="toggle-row">
          <div className="txt">
            {t('pushToggle', lang)}
            <small>{t('pushToggleNote', lang)}</small>
          </div>
          <button
            className={`switch ${pushStatus === 'subscribed' ? 'on' : ''}`}
            onClick={togglePush}
            disabled={pushBusy}
          />
        </div>
      )}
      {pushError && <div className="login-error" style={{ marginTop: -8, marginBottom: 12 }}>{pushError}</div>}

      {vehicles.length > 0 && (
        <div className="prof-row">
          <span>🚐 {t('vehicleLabel', lang)}</span>
          <select
            className="vehicle-select"
            value={profile?.vehicle_id || ''}
            onChange={(e) => selectVehicle(e.target.value)}
            disabled={savingVehicle}
          >
            <option value="">—</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.model}{v.plate ? ` · ${v.plate}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {isOwner && companyDrivers.length > 0 && (
        <>
          <h3 className="settings-subheading">{t('autoAssignHeading', lang)}</h3>
          <div className="toggle-row">
            <div className="txt">
              {t('autoAssignToggle', lang)}
              <small>{t('autoAssignToggleNote', lang)}</small>
            </div>
            <button
              className={`switch ${autoAssignEnabled ? 'on' : ''}`}
              onClick={() => { const v = !autoAssignEnabled; setAutoAssignEnabled(v); saveAssignPrefs({ auto_assign_enabled: v }) }}
              disabled={savingAssignPrefs}
            />
          </div>
        </>
      )}
    </div>
  )
}

function initials(nameOrEmail) {
  if (!nameOrEmail) return '?'
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail
  const parts = base.trim().split(/\s+/)
  const chars = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || '')
  return chars.join('') || '?'
}

function PlaceholderScreen({ title, note }) {
  return (
    <div className="placeholder-screen">
      <h2>{title}</h2>
      <p>{note}</p>
    </div>
  )
}
