import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { t, getLang, setLang, availableLangs } from './i18n'
import { Truck, CheckCircle2, Wallet, User, LogOut, Menu, Bell, MapPin, FlagTriangleRight, Tag, XCircle, Download, X, Navigation, Trophy, ThumbsUp } from 'lucide-react'
import './index.css'

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
      <div className="brand-mark">
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

function DriverShell({ session, profile, onProfileChange, lang, onChangeLang }) {
  const [tab, setTab] = useState('curse')
  const [menuOpen, setMenuOpen] = useState(false)
  const isOwner = profile?.account_type === 'owner_operator'
  const watchIdRef = useRef(null)

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

    const sendPosition = (coords) => {
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
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [profile?.is_online, profile?.id])

  function navTo(tabId) {
    setTab(tabId)
    setMenuOpen(false)
  }

  return (
    <div className="phone-shell">
      <div className="brand-strip">
        <span className="brand-strip-name"><span className="live-dot" /> Zimand Express</span>
        <button className="hbtn" aria-label="menu" onClick={() => setMenuOpen(true)}><Menu size={20} strokeWidth={2} /></button>
      </div>

      <div className="screen-body">
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

      <div className={`menu-overlay ${menuOpen ? 'show' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) setMenuOpen(false) }}>
        <div className="menu-drawer">
          <div className="menu-header">
            <span className="live-dot" /><span className="menu-header-name">Zimand Express</span>
          </div>
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

          <div className="menu-divider" />

          <button className="menu-item logout" onClick={() => supabase.auth.signOut()}>
            <span className="ic"><LogOut size={19} strokeWidth={1.75} /></span>{t('logout', lang)}
          </button>
        </div>
      </div>
    </div>
  )
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

function playBusinessChime() {
  try {
    const ctx = getSharedAudioCtx()
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}) }
    const now = ctx.currentTime
    const playTone = (freq, start, duration, gain = 0.14) => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      g.gain.setValueAtTime(0, now + start)
      g.gain.linearRampToValueAtTime(gain, now + start + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, now + start + duration)
      osc.connect(g)
      g.connect(ctx.destination)
      osc.start(now + start)
      osc.stop(now + start + duration + 0.05)
    }
    playTone(880, 0, 0.16)
    playTone(1174.66, 0.15, 0.24)
  } catch (err) {
    console.error('sound error:', err.message)
  }
}

// Notificări push — funcționează chiar cu telefonul blocat sau aplicația
// complet închisă (spre deosebire de playBusinessChime, care sună doar
// cât timp aplicația e deschisă pe ecran). Cheia publică e sigură de expus
// direct în cod — doar cheia PRIVATĂ (păstrată exclusiv pe server) permite
// trimiterea efectivă de notificări.
const VAPID_PUBLIC_KEY = 'BEpxgH8YgPfWzEXVtiseNj-kw0TgE3fcj3MPOA2OncaqtAooQnWcMFJsfos9JWVrNd9lRZUkW88UC7XLbwU_RJ4'

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
  return sub ? 'subscribed' : 'unsubscribed'
}

async function subscribePush(driverId) {
  const reg = await navigator.serviceWorker.ready
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Berechtigung für Benachrichtigungen wurde nicht erteilt.')
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
  const [celebration, setCelebration] = useState(null) // number (net earnings) | true (no amount) | null — la nivel de ecran, supraviețuiește comutării spre CompletedOrderDetail
  const [notifyRadiusKm, setNotifyRadiusKm] = useState(null)
  const openCountLoaded = useRef(false)
  const driverLocationForNotify = useDriverLocation(session)
  const mapsKeyForNotify = useGoogleMapsKey()

  useEffect(() => {
    if (!isOwner || !profile?.id) return
    supabase.from('profiles').select('preferred_radius_km').eq('id', profile.id).maybeSingle()
      .then(({ data }) => { if (data?.preferred_radius_km) setNotifyRadiusKm(data.preferred_radius_km) })
  }, [isOwner, profile?.id])

  useEffect(() => {
    if (!isOwner) return

    function refreshOpenCount() {
      Promise.all([
        supabase.from('orders').select('id').eq('status', 'open').or('on_hold.is.null,on_hold.eq.false'),
        supabase.from('bids').select('order_id').eq('courier_id', session?.user?.id),
      ]).then(([openRes, bidsRes]) => {
        const biddedIds = new Set((bidsRes.data || []).map((b) => b.order_id))
        const remaining = (openRes.data || []).filter((o) => !biddedIds.has(o.id)).length
        setOpenCount(remaining)
      })
    }

    refreshOpenCount()
    openCountLoaded.current = true

    const channel = supabase
      .channel('rides-open-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'status=eq.open' }, async (payload) => {
        refreshOpenCount()
        if (payload.eventType === 'INSERT' && openCountLoaded.current && !payload.new?.on_hold) {
          // Dacă șoferul are o rază preferată setată, notificăm doar pentru
          // comenzi din acel raion — cele mai îndepărtate rămân vizibile
          // în listă, dar fără sunet/notificare.
          let withinRadius = true
          if (notifyRadiusKm != null && driverLocationForNotify && mapsKeyForNotify && payload.new?.pickup_address) {
            const point = await geocodeAddressCached(payload.new.pickup_address, mapsKeyForNotify)
            if (point) {
              const km = haversineKm(driverLocationForNotify.lat, driverLocationForNotify.lng, point.lat, point.lng)
              withinRadius = km <= notifyRadiusKm
            }
          }
          if (withinRadius) {
            playBusinessChime()
            setNewOrderToast(true)
            setTimeout(() => setNewOrderToast(false), 4000)
          }
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids', filter: `courier_id=eq.${session?.user?.id}` }, refreshOpenCount)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [isOwner, notifyRadiusKm, driverLocationForNotify, mapsKeyForNotify, session?.user?.id])

  function setSelectedId(id) {
    setSelectedIdState(id)
    if (id) {
      sessionStorage.setItem('zd-open-order', id)
    } else {
      sessionStorage.removeItem('zd-open-order')
    }
  }

  useEffect(() => {
    if (!profile?.id) {
      setLoading(false)
      return
    }

    let active = true

    supabase
      .from('orders')
      .select('*')
      .eq('assigned_driver_id', profile.id)
      .then(({ data, error }) => {
        if (error) console.error('orders fetch error:', error.message)
        if (active) {
          setOrders(data || [])
          setLoading(false)
        }
      })

    const channel = supabase
      .channel('driver-orders-' + profile.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `assigned_driver_id=eq.${profile.id}` },
        (payload) => {
          setOrders((current) => {
            if (payload.eventType === 'DELETE') {
              return current.filter((o) => o.id !== payload.old.id)
            }
            const exists = current.some((o) => o.id === payload.new.id)
            if (exists) {
              return current.map((o) => (o.id === payload.new.id ? payload.new : o))
            }
            return [...current, payload.new]
          })
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [profile?.id])

  if (loading) return <PlaceholderScreen title={t('tabRides', lang)} note={t('loadingRides', lang)} />

  const selected = orders.find((o) => o.id === selectedId)
  if (selected && (selected.status === 'done' || selected.status === 'cancelled')) {
    return <CompletedOrderDetail order={selected} isOwner={isOwner} lang={lang} onBack={() => setSelectedId(null)} />
  }
  if (selected) {
    return <RideDetailScreen order={selected} isOwner={isOwner} session={session} lang={lang} onBack={() => setSelectedId(null)} onStatusChange={() => {}} onDeliveryComplete={(amount) => setCelebration(amount)} />
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
      .select('*')
      .eq('assigned_driver_id', profile.id)
      .in('status', ['done', 'cancelled'])
      .then(({ data, error }) => {
        if (error) console.error('completed orders fetch error:', error.message)
        setOrders(data || [])
        setLoading(false)
      })
  }, [profile?.id])

  if (loading) return <PlaceholderScreen title={t('menuCompleted', lang)} note={t('loadingRides', lang)} />

  const selected = orders.find((o) => o.id === selectedId)
  if (selected) {
    return <CompletedOrderDetail order={selected} isOwner={isOwner} lang={lang} onBack={() => setSelectedId(null)} />
  }

  const sorted = [...orders].sort((a, b) => {
    const da = a.delivery_confirmed_at || a.delivery_date || ''
    const db = b.delivery_confirmed_at || b.delivery_date || ''
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
          <span className="ride-row-route">{order.pickup_address} → {order.delivery_address}</span>
          {isCancelled ? (
            <span className="ride-row-date">{statusLabel(order.status, lang)}</span>
          ) : order.delivery_confirmed_at && (
            <span className="ride-row-date">{t('delivery', lang)}: {fmtDate(order.delivery_confirmed_at)}</span>
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
          <span className={`ride-badge ${statusClass(order.status)}`} style={{ marginLeft: 8 }}>{statusLabel(order.status, lang)}</span>
        </div>

        <div className="bid-stop"><span className="addr"><MapPin size={13} strokeWidth={1.8} /> {order.pickup_address}</span></div>
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
            {isOwner && order.estimated_price != null && <span className="meta-item price">{order.estimated_price} €</span>}
          </div>
        </div>
      </div>

      <button className="ride-card2-action" onClick={onClick}>
        👁 {t('viewDetails', lang)}
      </button>
    </div>
  )
}

function useGeocode(address) {
  const [coords, setCoords] = useState(null)

  useEffect(() => {
    if (!address) return
    let active = true
    fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((results) => {
        if (!active || !results || !results[0]) return
        setCoords([parseFloat(results[0].lat), parseFloat(results[0].lon)])
      })
      .catch((err) => console.error('geocode error:', err.message))
    return () => {
      active = false
    }
  }, [address])

  return coords
}

function mapsNavUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
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

function GoogleLiveMap({ pickupCoords, deliveryCoords }) {
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
        label: { text: label, color: '#fff', fontWeight: '700', fontSize: '12px' },
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

    if (pickupCoords) addMarker(pickupCoords, 'A', '#FF7A29')
    if (deliveryCoords) addMarker(deliveryCoords, 'B', '#0F2240')

    if (pickupCoords && deliveryCoords) {
      const directionsService = new window.google.maps.DirectionsService()
      directionsService.route(
        {
          origin: { lat: pickupCoords[0], lng: pickupCoords[1] },
          destination: { lat: deliveryCoords[0], lng: deliveryCoords[1] },
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === 'OK') {
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
  }, [pickupCoords, deliveryCoords, ready])

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

function RideDetailScreen({ order, isOwner, session, lang, onBack, onStatusChange, onDeliveryComplete }) {
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
    const { error } = await supabase
      .from('orders')
      .update({ assigned_driver_id: reassignTo })
      .eq('id', order.id)
    setReassigning(false)
    if (error) {
      console.error('reassign error:', error.message)
      alert(error.message)
      return
    }
    onStatusChange()
    onBack()
  }

  // which leg are we on: pickup or delivery
  const leg = !order.pickup_confirmed_at ? 'pickup' : 'delivery'
  const startedAt = leg === 'pickup' ? order.pickup_started_at : order.delivery_started_at
  const arrivedAt = leg === 'pickup' ? order.pickup_arrived_at : order.delivery_arrived_at
  const confirmedAt = leg === 'pickup' ? order.pickup_confirmed_at : order.delivery_confirmed_at

  // Formularul de confirmare (poze/documente/nume/semnătură) se deschide
  // automat de îndată ce șoferul a ajuns la locație. "Zurück" în acest
  // pas special NU trebuie să scoată șoferul din comandă — doar închide
  // formularul, ca să revadă detaliile (adresă, marfă), fără să piardă
  // progresul deja înregistrat ("Angekommen" rămâne bifat). Apăsând din
  // nou pe caseta etapei active, formularul se redeschide.
  const [confirmFormOpen, setConfirmFormOpen] = useState(true)
  const inConfirmStep = order.status === 'assigned' && !!arrivedAt && !confirmedAt

  function handleBack() {
    if (inConfirmStep && confirmFormOpen) {
      setConfirmFormOpen(false)
      return
    }
    onBack()
  }

  return (
    <div className="ride-detail">
      <button className="back-btn" onClick={handleBack}>← {t('back', lang)}</button>

      <div className="ride-detail-header">
        <span className="ride-ref">{t('orderRef', lang)} {order.order_number || order.reference || order.id.slice(0, 8)}</span>
        <span className={`ride-badge ${statusClass(order.status)}`}>
          {statusLabel(order.status, lang)}
        </span>
      </div>

      <GoogleLiveMap pickupCoords={pickupCoords} deliveryCoords={deliveryCoords} />

      {companyName && (
        <div className="info-card">
          <div className="info-card-head">🏢 {companyName}</div>
        </div>
      )}

      {order.status === 'assigned' && !confirmedAt && confirmFormOpen && (
        <LegWorkflow key={leg} order={order} leg={leg} lang={lang} startedAt={startedAt} arrivedAt={arrivedAt} onStatusChange={onStatusChange} isOwner={isOwner} onDeliveryComplete={() => onDeliveryComplete(isOwner ? order.estimated_price : true)} />
      )}

      {order.status === 'assigned' && order.pickup_confirmed_at && !order.delivery_confirmed_at && leg === 'delivery' && null}

      {!(inConfirmStep && confirmFormOpen) && (
      <>
      <div className="info-card">
        <div
          className={`info-card-head leg-head-line ${order.pickup_started_at && !order.pickup_arrived_at ? 'en-route' : ''}`}
          {...(leg === 'pickup' && arrivedAt && !confirmedAt ? { onClick: () => setConfirmFormOpen(true), style: { cursor: 'pointer' } } : {})}
        >
          <span className="leg-head-left">
            🅐 {t('pickup', lang)}
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
          {order.pickup_started_at && !order.pickup_arrived_at && (
            <span className="leg-en-route-pill">{t('enRouteLabel', lang)} <span className="moving-van">🚚</span></span>
          )}
        </div>
        <div className="info-card-body">
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
        </div>
      </div>

      <div className="info-card">
        <div
          className={`info-card-head leg-head-line ${order.delivery_started_at && !order.delivery_arrived_at ? 'en-route' : ''}`}
          {...(leg === 'delivery' && arrivedAt && !confirmedAt ? { onClick: () => setConfirmFormOpen(true), style: { cursor: 'pointer' } } : {})}
        >
          <span className="leg-head-left">
            🅑 {t('delivery', lang)}
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
          {order.delivery_started_at && !order.delivery_arrived_at && (
            <span className="leg-en-route-pill">{t('enRouteLabel', lang)} <span className="moving-van">🚚</span></span>
          )}
        </div>
        <div className="info-card-body">
          <ContactRow contact={deliveryContact} lang={lang} />
          <div className="info-row address-row">
            <span className="address-text">{order.delivery_address}</span>
            <a className="maps-nav-btn" href={mapsNavUrl(order.delivery_address)} target="_blank" rel="noreferrer"><Navigation size={13} strokeWidth={2.2} /> {t('navigateButton', lang)}</a>
          </div>
          {order.delivery_confirmed_at && <div className="info-row-time">✓ {fmtDateTime(order.delivery_confirmed_at)}</div>}
          {deliveryNotiz && <div className="leg-notiz">📝 {deliveryNotiz}</div>}
        </div>
      </div>
      </>
      )}

      <div className="info-card">
        <div className="info-card-head cargo-toggle" onClick={() => setCargoOpen((v) => !v)}>
          <span>📦 {t('cargoLabel', lang)}</span>
          <span className={`cargo-chev ${cargoOpen ? 'open' : ''}`}>▼</span>
        </div>
        {cargoOpen && (
          <div className="info-card-body">
            {order.shipment_type && <div className="info-row"><span className="k">📦</span><span className="v">{SHIPMENT_TYPE_LABELS[order.shipment_type] || order.shipment_type}{order.quantity ? ` (${order.quantity}×)` : ''}</span></div>}
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

function ElapsedTimer({ startedAt }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0')
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

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

function LegWorkflow({ order, leg, lang, startedAt, arrivedAt, onStatusChange, isOwner, onDeliveryComplete }) {
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState([])
  const [documents, setDocuments] = useState([])
  const [docType, setDocType] = useState('cmr')
  const [signatureBlob, setSignatureBlob] = useState(null)
  const [signerName, setSignerName] = useState('')
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const docInputRef = useRef(null)
  const [photoSourceOpen, setPhotoSourceOpen] = useState(false)

  const startFn = leg === 'pickup' ? 'driver_mark_pickup_started' : 'driver_mark_delivery_started'
  const arriveFn = leg === 'pickup' ? 'driver_mark_pickup_arrived' : 'driver_mark_delivery_arrived'
  const confirmFn = leg === 'pickup' ? 'driver_confirm_pickup' : 'driver_confirm_delivery'
  const legLabel = leg === 'pickup' ? t('pickup', lang) : t('delivery', lang)

  async function callRpc(fn) {
    setBusy(true)
    const { error } = await supabase.rpc(fn, { p_order_id: order.id })
    setBusy(false)
    if (error) {
      console.error(fn, error.message)
      return
    }
    onStatusChange()
  }

  function addPhotos(e) {
    const files = Array.from(e.target.files || [])
    const withPreview = files.map((f) => ({ file: f, previewUrl: URL.createObjectURL(f) }))
    setPhotos((prev) => [...prev, ...withPreview].slice(0, 6))
    e.target.value = ''
  }

  function removePhoto(idx) {
    setPhotos((prev) => {
      const removed = prev[idx]
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  // Eliberează toate preview-urile blob rămase când componenta se demontează
  // (schimbare de etapă pickup/delivery, ieșire din ecran etc.) — evită
  // scurgeri de memorie și pozele "blocate" din URL-uri vechi neeliberate.
  useEffect(() => {
    return () => { photos.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [docGuideOpen, setDocGuideOpen] = useState(false)

  function addDocument(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setDocuments((prev) => [...prev, { type: docType, file }])
  }

  function removeDocument(idx) {
    setDocuments((prev) => prev.filter((_, i) => i !== idx))
  }

  async function confirmLeg() {
    setBusy(true)
    try {
      const photoPaths = []
      for (const p of photos) {
        photoPaths.push(await uploadPodFile(order.id, leg, p.file))
      }
      const uploadedDocs = []
      for (const doc of documents) {
        const path = await uploadPodFile(order.id, leg, doc.file)
        uploadedDocs.push({ type: doc.type, path, name: doc.file.name })
      }
      let signaturePath = null
      if (signatureBlob) {
        const sigFile = new File([signatureBlob], 'signature.png', { type: 'image/png' })
        signaturePath = await uploadPodFile(order.id, leg, sigFile)
      }
      const { error } = await supabase.rpc(confirmFn, {
        p_order_id: order.id,
        p_photos: photoPaths,
        p_documents: uploadedDocs,
        p_signature_url: signaturePath,
        p_signer_name: signerName || null,
      })
      if (error) throw error
      onStatusChange()
      if (leg === 'delivery' && onDeliveryComplete) onDeliveryComplete()

      // Trimite pozele/documentele/semnătura către portalul de client —
      // dacă eșuează, nu blocăm confirmarea (deja salvată cu succes mai sus).
      const { data: sessionData } = await supabase.auth.getSession()
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-delivery-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData?.session?.access_token}` },
        body: JSON.stringify({ order_id: order.id, leg }),
      }).catch((syncErr) => console.error('sync-delivery-documents error:', syncErr.message))
    } catch (err) {
      console.error('confirm leg error:', err.message)
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
      <button className="btn sticky-cta" onClick={() => callRpc(startFn)} disabled={busy}>
        {t('startDriving', lang)}
      </button>
    )
  }

  if (!arrivedAt) {
    return (
      <button className="btn sticky-cta" onClick={() => callRpc(arriveFn)} disabled={busy}>
        {t('arrived', lang)}
      </button>
    )
  }

  return (
    <div className="leg-workflow">
      <div className="leg-title">{legLabel} · {t('confirmStep', lang)}</div>

      <div className="pod-label">{t('photosLabel', lang)} ({photos.length}/6)</div>
      <div className="photo-grid">
        {photos.map((p, i) => (
          <div className="photo-slot filled" key={i} onClick={() => removePhoto(i)}>
            <img src={p.previewUrl} alt="" />
          </div>
        ))}
        {photos.length < 6 && (
          <div className="photo-slot" onClick={() => setPhotoSourceOpen(true)}>+</div>
        )}
      </div>

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
      <div className="doc-guide-hint" onClick={() => setDocGuideOpen(true)}>
        💡 {t('docGuideHint', lang)}
      </div>
      <div className="doc-type-row">
        <select className="doc-type-select" value={docType} onChange={(e) => setDocType(e.target.value)}>
          <option value="cmr">{t('docTypeCmr', lang)}</option>
          <option value="zustellprotokoll">{t('docTypeProtocol', lang)}</option>
          <option value="other">{t('docTypeOther', lang)}</option>
        </select>
        <button type="button" className="btn secondary doc-add-btn" onClick={() => docInputRef.current?.click()}>
          {t('addDocument', lang)}
        </button>
      </div>

      {docGuideOpen && (
        <div className="sig-fullscreen">
          <div className="sig-fullscreen-header">
            <span>{t('docGuideTitle', lang)}</span>
            <button type="button" className="sig-fullscreen-close" onClick={() => setDocGuideOpen(false)}>✕</button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <svg viewBox="0 0 280 220" style={{ width: '100%', maxWidth: 280 }}>
              <rect x="10" y="10" width="260" height="200" rx="12" fill="#F6F8FA" stroke="#E7EAF0" strokeWidth="2" />
              <rect x="55" y="35" width="170" height="150" rx="4" fill="#fff" stroke="#0F2240" strokeWidth="2.5" />
              <line x1="75" y1="60" x2="195" y2="60" stroke="#C7D0DE" strokeWidth="3" />
              <line x1="75" y1="80" x2="195" y2="80" stroke="#C7D0DE" strokeWidth="3" />
              <line x1="75" y1="100" x2="160" y2="100" stroke="#C7D0DE" strokeWidth="3" />
              <line x1="75" y1="140" x2="195" y2="140" stroke="#C7D0DE" strokeWidth="3" />
              <line x1="75" y1="160" x2="150" y2="160" stroke="#C7D0DE" strokeWidth="3" />
              {/* colțuri evidențiate */}
              <path d="M55 45 v-10 h10" fill="none" stroke="#FF7A29" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M215 45 v-10 h-10" fill="none" stroke="#FF7A29" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M55 175 v10 h10" fill="none" stroke="#FF7A29" strokeWidth="3.5" strokeLinecap="round" />
              <path d="M215 175 v10 h-10" fill="none" stroke="#FF7A29" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ padding: '0 20px 20px' }}>
            <p style={{ fontSize: 13, color: 'var(--text-soft)', textAlign: 'center', lineHeight: 1.6, margin: '0 0 16px' }}>{t('docGuideText', lang)}</p>
            <button type="button" className="btn" onClick={() => setDocGuideOpen(false)}>{t('docGuideClose', lang)}</button>
          </div>
        </div>
      )}
      {documents.length > 0 && (
        <div className="doc-chip-list">
          {documents.map((doc, i) => (
            <div className="cmr-chip" key={i} onClick={() => removeDocument(i)}>
              {doc.type === 'cmr' ? t('docTypeCmr', lang) : doc.type === 'zustellprotokoll' ? t('docTypeProtocol', lang) : t('docTypeOther', lang)}
              {' · '}{doc.file.name} ✕
            </div>
          ))}
        </div>
      )}
      <input
        ref={docInputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={addDocument}
      />

      <div className="pod-label">{t(leg === 'pickup' ? 'signerNameLabelPickup' : 'signerNameLabelDelivery', lang)}</div>
      <input
        className="bid-input2"
        type="text"
        value={signerName}
        onChange={(e) => setSignerName(e.target.value)}
        placeholder={t('signerNamePlaceholder', lang)}
      />

      <SignatureLine lang={lang} signatureBlob={signatureBlob} onChange={setSignatureBlob} />

      <button className="btn" onClick={confirmLeg} disabled={busy} style={{ marginTop: 14 }}>
        {busy ? '…' : leg === 'pickup' ? t('confirmPickup', lang) : t('confirmDelivery', lang)}
      </button>
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

function TimelineLeg({ leg, order, lang }) {
  const startedAt = leg === 'pickup' ? order.pickup_started_at : order.delivery_started_at
  const arrivedAt = leg === 'pickup' ? order.pickup_arrived_at : order.delivery_arrived_at
  const confirmedAt = leg === 'pickup' ? order.pickup_confirmed_at : order.delivery_confirmed_at
  const photoPaths = leg === 'pickup' ? order.pickup_photos : order.delivery_photos
  const documents = (leg === 'pickup' ? order.pickup_documents : order.delivery_documents) || []
  const signaturePath = leg === 'pickup' ? order.pickup_signature_url : order.delivery_signature_url
  const signerName = leg === 'pickup' ? order.pickup_signer_name : order.delivery_signer_name
  const photoUrls = useSignedUrls(photoPaths || [])
  const signatureUrl = useSignedUrl(signaturePath)

  if (!startedAt) return null

  return (
    <>
      <div className="tl-leg-label">{leg === 'pickup' ? '🅐 ' + t('pickup', lang) : '🅑 ' + t('delivery', lang)}</div>
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
          <div className="tl-title">{leg === 'pickup' ? t('confirmPickup', lang) : t('confirmDelivery', lang)}</div>
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

  const net = order.estimated_price

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

      <GoogleLiveMap pickupCoords={pickupCoords} deliveryCoords={deliveryCoords} />

      {order.status !== 'cancelled' && (
        <div className="timeline">
          <TimelineLeg leg="pickup" order={order} lang={lang} />
          <TimelineLeg leg="delivery" order={order} lang={lang} />
        </div>
      )}
    </div>
  )
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

    function load() {
      supabase
        .from('bids')
        .select('*, orders!bids_order_id_fkey(*)')
        .eq('courier_id', courierProfileId)
        .then(({ data, error }) => {
          if (error) console.error('bids fetch error:', error.message)
          if (active) { setBids(data || []); setLoading(false) }
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
    const { error } = await supabase
      .from('orders')
      .update({ assigned_driver_id: selected })
      .eq('id', order.id)
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
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2) return address // format necunoscut — afișăm ce avem, mai sigur decât să ascundem greșit
  const countryRaw = parts[parts.length - 1]
  const plzCity = parts[parts.length - 2]
  const countryCode = COUNTRY_CODES[countryRaw] || countryRaw
  return `${plzCity} · ${countryCode}`
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

function EarningsScreen({ profile, lang }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    if (!profile?.id) { setLoading(false); return }
    supabase
      .from('orders')
      .select('*')
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
    .map((o) => ({ ...o, _refDate: o.delivery_confirmed_at || o.delivery_date }))
    .filter((o) => o._refDate)

  const currentWeekStart = getWeekStart(new Date().toISOString())
  const byWeek = new Map()
  withDate.forEach((o) => {
    const ws = getWeekStart(o._refDate)
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

  const currentTotal = currentWeek.orders.reduce((sum, o) => sum + (o.estimated_price || 0), 0)
  const weekEnd = new Date(currentWeekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  function openSummary(o) {
    const net = o.estimated_price || 0
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
        <div className="lbl">{t('earningsWeekLabel', lang)}</div>
        <div className="amt">{currentTotal.toFixed(2)} €</div>
        <div className="row">
          <div>{t('earningsPeriod', lang)}<b>{formatDateShort(currentWeekStart)}–{formatDateShort(weekEnd)}</b></div>
          <div>{t('tabRides', lang)}<b>{currentWeek.orders.length}</b></div>
        </div>
      </div>

      <div className="section-heading">{t('earningsThisWeek', lang)} <span className="count-pill">{currentWeek.orders.length}</span></div>
      {currentWeek.orders.length === 0 ? (
        <div className="empty-note">{t('noRides', lang)}</div>
      ) : (
        currentWeek.orders.map((o) => (
          <div className="hist-item" key={o.id} onClick={() => openSummary(o)}>
            <div><div className="id">{o.order_number || o.reference || o.id.slice(0, 8)}</div>{o.pickup_address} → {o.delivery_address}</div>
            <div className="p">{(o.estimated_price || 0).toFixed(2)} €</div>
          </div>
        ))
      )}

      {otherWeeks.length > 0 && (
        <>
          <div className="section-heading">{t('earningsPreviousWeeks', lang)}</div>
          {otherWeeks.map((w) => {
            const end = new Date(w.start)
            end.setDate(end.getDate() + 6)
            const total = w.orders.reduce((sum, o) => sum + (o.estimated_price || 0), 0)
            return (
              <div className="hist-item" key={w.start.toISOString()} style={{ opacity: 0.75 }}>
                <div><div className="id">{formatDateShort(w.start)}–{formatDateShort(end)}</div>{w.orders.length} {t('tabRides', lang)}</div>
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
async function geocodeAddressCached(address, mapsKey) {
  if (geocodeCache.has(address)) return geocodeCache.get(address)
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${mapsKey}`)
    const data = await res.json()
    const loc = data?.results?.[0]?.geometry?.location
    const result = loc ? { lat: loc.lat, lng: loc.lng } : null
    geocodeCache.set(address, result)
    return result
  } catch {
    return null
  }
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
  const [orderDistances, setOrderDistances] = useState({}) // { orderId: km | null }
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
    supabase
      .from('orders')
      .select('*')
      .eq('status', 'open')
      .or('on_hold.is.null,on_hold.eq.false')
      .order('pickup_date', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error('open orders fetch error:', error.message)
        if (active) { setOrders(data || []); setLoading(false) }
      })

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
        supabase.from('orders').select('*').eq('status', 'open').or('on_hold.is.null,on_hold.eq.false').then(({ data }) => setOrders(data || []))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids', filter: `courier_id=eq.${courierProfileId}` }, () => {
        supabase.from('bids').select('order_id').eq('courier_id', courierProfileId).then(({ data }) => setBiddedOrderIds(new Set((data || []).map((b) => b.order_id))))
      })
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
  }, [courierProfileId])

  // odată ce ai licitat, comanda trece exclusiv la "Meine Angebote" — nu mai
  // rămâne și în "Verfügbar"
  const availableOrders = orders.filter((o) => !biddedOrderIds.has(o.id))

  // Calculăm distanța (geocodificare + Haversine) doar pentru comenzile
  // vizibile acum, o singură dată fiecare — nu la fiecare randare.
  useEffect(() => {
    if (!isOwner || !driverLocation || !mapsKey) return
    let cancelled = false
    ;(async () => {
      for (const o of availableOrders) {
        if (orderDistances[o.id] !== undefined) continue
        const point = await geocodeAddressCached(o.pickup_address, mapsKey)
        if (cancelled) return
        const km = point ? Math.round(haversineKm(driverLocation.lat, driverLocation.lng, point.lat, point.lng)) : null
        setOrderDistances((prev) => ({ ...prev, [o.id]: km }))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocation, mapsKey, availableOrders.map((o) => o.id).join(',')])

  // Nimic nu se mai ascunde — doar sortăm cele apropiate primele; comenzile
  // mai îndepărtate rămân vizibile, doar coboară spre finalul listei.
  const sortedOrders = [...availableOrders].sort((a, b) => {
    if (radiusKm == null) return 0
    const da = orderDistances[a.id]
    const db = orderDistances[b.id]
    if (da == null && db == null) return 0
    if (da == null) return 1
    if (db == null) return -1
    return da - db
  })

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
        <BidCard key={o.id} order={o} lang={lang} courierProfileId={courierProfileId} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? null : o.id)} onBidPlaced={(orderId) => setBiddedOrderIds((prev) => new Set(prev).add(orderId))} distanceKm={isOwner ? orderDistances[o.id] : null} />
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

function BidCard({ order, lang, courierProfileId, open, onToggle, onBidPlaced, distanceKm }) {
  const [ownPrice, setOwnPrice] = useState('')
  const [message, setMessage] = useState('')
  const [respectInterval, setRespectInterval] = useState(true)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [existingBid, setExistingBid] = useState(null)
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
          .update({ price: amount, message: message || null, eta_from: etaFrom, eta_to: etaTo })
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
            {distanceKm != null && <span className="meta-item">🚗 {distanceKm} km bis zu dir</span>}
            {order.weight && <span className="meta-item">⚖ {order.weight} kg</span>}
          </div>
        </div>
      </div>

      <div className="bid-card2-body">
        <div className="bid-body-inner">
          {order.shipment_type && (
            <div className="shipment-type-row">
              📦 {SHIPMENT_TYPE_LABELS[order.shipment_type] || order.shipment_type}{order.quantity ? ` (${order.quantity}×)` : ''}
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
