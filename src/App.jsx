import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { t, getLang, setLang, availableLangs } from './i18n'
import { Truck, CheckCircle2, Wallet, User, LogOut, Menu, Bell, MapPin, FlagTriangleRight, Tag, XCircle, Download, X, Navigation } from 'lucide-react'
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

function playBusinessChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
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

function RidesScreen({ profile, isOwner, session, lang }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedIdState] = useState(() => sessionStorage.getItem('zd-open-order') || null)
  const [activeTab, setActiveTab] = useState('mine')
  const [sortAsc, setSortAsc] = useState(true)
  const [openCount, setOpenCount] = useState(0)
  const [newOrderToast, setNewOrderToast] = useState(false)
  const openCountLoaded = useRef(false)

  useEffect(() => {
    if (!isOwner) return

    function refreshOpenCount() {
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .then(({ count }) => setOpenCount(count || 0))
    }

    refreshOpenCount()
    openCountLoaded.current = true

    const channel = supabase
      .channel('rides-open-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'status=eq.open' }, (payload) => {
        refreshOpenCount()
        if (payload.eventType === 'INSERT' && openCountLoaded.current) {
          playBusinessChime()
          setNewOrderToast(true)
          setTimeout(() => setNewOrderToast(false), 4000)
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [isOwner])

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
    return <RideDetailScreen order={selected} isOwner={isOwner} session={session} lang={lang} onBack={() => setSelectedId(null)} onStatusChange={() => {}} />
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

  return (
    <div className="ride-card2">
      <div className="ride-card2-top">
        <div className="ride-card2-id">
          <span className="ride-card2-icon">🚚</span>
          <span className="ride-card2-num">{order.order_number || order.reference || order.id.slice(0, 8)}</span>
        </div>
        <span className={`ride-badge ${statusClass(order.status)}`}>{statusLabel(order.status, lang)}</span>
      </div>

      <div className="ride-card2-route">{order.pickup_address} → {order.delivery_address}</div>

      <div className="ride-card2-rows">
        <div className="ride-card2-row">
          <span className="ric">📅</span>
          <span className="rik">{t('pickup', lang)}</span>
          <span className="riv">
            {isToday(order.pickup_date) && <span className="pill heute" style={{ marginRight: 6 }}>{t('todayBadge', lang)}</span>}
            {!isToday(order.pickup_date) && isTomorrow(order.pickup_date) && <span className="pill morgen" style={{ marginRight: 6 }}>{t('tomorrowBadge', lang)}</span>}
            {order.pickup_fixed ? (
              <span className="fixed-time-badge">🔒 {fmtDate(order.pickup_date)}{order.pickup_time ? ` · ${fmtTime(order.pickup_time)}` : ''}</span>
            ) : (
              <>{fmtDate(order.pickup_date)}{order.pickup_from ? `, ${fmtTime(order.pickup_from)}` : ''}{order.pickup_to ? `–${fmtTime(order.pickup_to)}` : ''}</>
            )}
          </span>
        </div>
        <div className="ride-card2-row">
          <span className="ric">📅</span>
          <span className="rik">{t('delivery', lang)}</span>
          <span className="riv">
            {order.delivery_fixed ? (
              <span className="fixed-time-badge">🔒 {fmtDate(order.delivery_date)}{order.delivery_time ? ` · ${fmtTime(order.delivery_time)}` : ''}</span>
            ) : (
              <>{fmtDate(order.delivery_date)}{order.delivery_from ? `, ${fmtTime(order.delivery_from)}` : ''}{order.delivery_to ? `–${fmtTime(order.delivery_to)}` : ''}</>
            )}
          </span>
        </div>
        {order.cargo_desc && (
          <div className="ride-card2-row">
            <span className="ric">📦</span>
            <span className="rik">{t('cargoLabel', lang)}</span>
            <span className="riv">{order.cargo_desc}{order.weight ? `, ${order.weight} kg` : ''}</span>
          </div>
        )}
        {isOwner && order.estimated_price != null && (
          <div className="ride-card2-row">
            <span className="ric">🏷️</span>
            <span className="rik">{t('priceLabel', lang)}</span>
            <span className="riv price">{order.estimated_price} €</span>
          </div>
        )}
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
        resultCanvas.toBlob((blob) => {
          if (blob) resolve(new File([blob], file.name, { type: 'image/jpeg' }))
          else resolve(file)
        }, 'image/jpeg', 0.9)
      } catch (e) {
        console.error('document scan error:', e.message)
        resolve(file)
      }
    }
    img.onerror = () => resolve(file)
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
  return (
    <div className="contact-row">
      <span className="contact-text">👤 {contact}</span>
      {phone && (
        <a className="contact-call" href={`tel:${phone.replace(/[\s\-()\/]/g, '')}`}>
          📞 {t('callButton', lang)}
        </a>
      )}
    </div>
  )
}

function RideDetailScreen({ order, isOwner, session, lang, onBack, onStatusChange }) {
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

  return (
    <div className="ride-detail">
      <button className="back-btn" onClick={onBack}>← {t('back', lang)}</button>

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

      {order.status === 'assigned' && !confirmedAt && (
        <LegWorkflow key={leg} order={order} leg={leg} lang={lang} startedAt={startedAt} arrivedAt={arrivedAt} onStatusChange={onStatusChange} />
      )}

      {order.status === 'assigned' && order.pickup_confirmed_at && !order.delivery_confirmed_at && leg === 'delivery' && null}

      <div className="info-card">
        <div className={`info-card-head leg-head-line ${order.pickup_started_at && !order.pickup_arrived_at ? 'en-route' : ''}`}>
          <span className="leg-head-left">
            🅐 {t('pickup', lang)}
            {order.pickup_date && <span className="leg-head-time"> · {order.pickup_fixed ? fmtTime(order.pickup_time) : fmtTime(order.pickup_from)}</span>}
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
          <LegTime order={order} prefix="pickup" lang={lang} />
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
        <div className={`info-card-head leg-head-line ${order.delivery_started_at && !order.delivery_arrived_at ? 'en-route' : ''}`}>
          <span className="leg-head-left">
            🅑 {t('delivery', lang)}
            {order.delivery_date && <span className="leg-head-time"> · {order.delivery_fixed ? fmtTime(order.delivery_time) : fmtTime(order.delivery_from)}</span>}
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
          <LegTime order={order} prefix="delivery" lang={lang} />
          {order.delivery_confirmed_at && <div className="info-row-time">✓ {fmtDateTime(order.delivery_confirmed_at)}</div>}
          {deliveryNotiz && <div className="leg-notiz">📝 {deliveryNotiz}</div>}
        </div>
      </div>

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
                {extractServiceBadges(order.notes).map(({ icon, key }) => (
                  <span key={key} className="service-badge">{icon} {t(key, lang)}</span>
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

function LegWorkflow({ order, leg, lang, startedAt, arrivedAt, onStatusChange }) {
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState([])
  const [documents, setDocuments] = useState([])
  const [docType, setDocType] = useState('cmr')
  const [signatureBlob, setSignatureBlob] = useState(null)
  const [signerName, setSignerName] = useState('')
  const fileInputRef = useRef(null)
  const docInputRef = useRef(null)

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
    setPhotos((prev) => [...prev, ...files].slice(0, 6))
    e.target.value = ''
  }

  function removePhoto(idx) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx))
  }

  const [scanningDoc, setScanningDoc] = useState(false)

  async function addDocument(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setScanningDoc(true)
    try {
      await loadDocumentScanner()
      const scanned = await scanDocument(file)
      setDocuments((prev) => [...prev, { type: docType, file: scanned }])
    } catch (err) {
      console.error('scanner load/run error:', err.message)
      // dacă scanerul nu se încarcă din vreun motiv, folosim poza originală
      setDocuments((prev) => [...prev, { type: docType, file }])
    }
    setScanningDoc(false)
  }

  function removeDocument(idx) {
    setDocuments((prev) => prev.filter((_, i) => i !== idx))
  }

  async function confirmLeg() {
    setBusy(true)
    try {
      const photoPaths = []
      for (const file of photos) {
        photoPaths.push(await uploadPodFile(order.id, leg, file))
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
        {photos.map((f, i) => (
          <div className="photo-slot filled" key={i} onClick={() => removePhoto(i)}>
            <img src={URL.createObjectURL(f)} alt="" />
          </div>
        ))}
        {photos.length < 6 && (
          <div className="photo-slot" onClick={() => fileInputRef.current?.click()}>+</div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        style={{ display: 'none' }}
        onChange={addPhotos}
      />

      <div className="pod-label">{t('documentsLabel', lang)}</div>
      <div className="doc-type-row">
        <select className="doc-type-select" value={docType} onChange={(e) => setDocType(e.target.value)}>
          <option value="cmr">{t('docTypeCmr', lang)}</option>
          <option value="zustellprotokoll">{t('docTypeProtocol', lang)}</option>
          <option value="other">{t('docTypeOther', lang)}</option>
        </select>
        <button type="button" className="btn secondary doc-add-btn" onClick={() => docInputRef.current?.click()} disabled={scanningDoc}>
          {scanningDoc ? `⏳ ${t('scanningDocument', lang)}` : t('addDocument', lang)}
        </button>
      </div>
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

      <div className="pod-label">{t('signerNameLabel', lang)}</div>
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
  const vat = net != null ? net * 0.19 : null

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
            <div>MwSt (19%)<b>{vat.toFixed(2)} €</b></div>
            <div>Gesamt<b>{(net + vat).toFixed(2)} €</b></div>
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

  useEffect(() => {
    if (!courierProfileId) { setLoading(false); return }
    let active = true
    supabase
      .from('bids')
      .select('*, orders(*)')
      .eq('courier_id', courierProfileId)
      .then(({ data, error }) => {
        if (error) console.error('bids fetch error:', error.message)
        if (active) { setBids(data || []); setLoading(false) }
      })
    return () => { active = false }
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
            <BidCard key={b.id} order={b.orders} lang={lang} courierProfileId={courierProfileId} open={false} onToggle={() => {}} />
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

const SERVICE_BADGE_PREFIXES = [
  { prefix: 'Verladehilfe gebucht', icon: '📦⬆️', key: 'loadHelpBadge' },
  { prefix: 'Entladehilfe gebucht', icon: '📦⬇️', key: 'unloadHelpBadge' },
  { prefix: 'Neutrale Zustellung', icon: '🕶️', key: 'neutralDeliveryBadge' },
]

function extractServiceBadges(notesText) {
  if (!notesText) return []
  const lines = notesText.split('\n')
  return SERVICE_BADGE_PREFIXES.filter(({ prefix }) => lines.some((l) => l.startsWith(prefix)))
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
]
function preWinSafeNotes(notesText) {
  if (!notesText) return ''
  return notesText
    .split('\n')
    .filter((line) => !PRE_WIN_HIDDEN_PREFIXES.some((p) => line.startsWith(p)))
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
    const vat = net * 0.19
    setSummary({
      id: o.order_number || o.reference || o.id.slice(0, 8),
      route: `${o.pickup_address} → ${o.delivery_address}`,
      km: o.km,
      net,
      vat,
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
            <div className="info-row"><span className="k">{t('priceLabel', lang)}</span><span className="v">{summary.net.toFixed(2)} €</span></div>
            <div className="info-row"><span className="k">MwSt (19%)</span><span className="v">{summary.vat.toFixed(2)} €</span></div>
            <div className="info-row"><span className="k">Gesamt</span><span className="v price">{(summary.net + summary.vat).toFixed(2)} €</span></div>
            <button className="filter-apply" style={{ marginTop: 16 }} onClick={() => setSummary(null)}>{t('back', lang)}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function BiddingScreen({ profile, session, lang, embedded }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const courierProfileId = session?.user?.id || null

  useEffect(() => {
    let active = true
    supabase
      .from('orders')
      .select('*')
      .eq('status', 'open')
      .order('pickup_date', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error('open orders fetch error:', error.message)
        if (active) { setOrders(data || []); setLoading(false) }
      })

    const channel = supabase
      .channel('bidding-open-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'status=eq.open' }, () => {
        supabase.from('orders').select('*').eq('status', 'open').then(({ data }) => setOrders(data || []))
      })
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
  }, [])

  if (loading) return <PlaceholderScreen title={embedded ? '' : t('tabBidding', lang)} note={t('loadingRides', lang)} />
  if (orders.length === 0) {
    return (
      <div className={embedded ? '' : 'rides-list'}>
        <PlaceholderScreen title={embedded ? '' : t('tabBidding', lang)} note={t('biddingPlaceholder', lang)} />
      </div>
    )
  }

  return (
    <div className={embedded ? '' : 'rides-list'}>
      {!embedded && <h2 className="screen-title">{t('tabBidding', lang)}</h2>}
      {orders.map((o) => (
        <BidCard key={o.id} order={o} lang={lang} courierProfileId={courierProfileId} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? null : o.id)} />
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

function BidCard({ order, lang, courierProfileId, open, onToggle }) {
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

  const idParts = [
    order.order_number || order.id.slice(0, 8),
    order.reference,
    order.cargo_desc,
  ].filter(Boolean)

  return (
    <div className={`bid-card2 ${open ? 'open' : ''}`}>
      <div className="bid-card2-head" onClick={onToggle}>
        <div className="bid-top-row">
          <div className="bid-top-left">
            {today && <span className="pill heute">{t('todayBadge', lang)}</span>}
            {!today && tomorrow && <span className="pill morgen">{t('tomorrowBadge', lang)}</span>}
            <span className="pill-label">{t('pickup', lang)}</span>
            <span className="pill-date">{fmtDate(order.pickup_date)}</span>
            <span className="pill-time">{order.pickup_fixed ? (order.pickup_time ? `🔒 ${fmtTime(order.pickup_time)}` : '🔒') : (order.pickup_from ? `${fmtTime(order.pickup_from)}${order.pickup_to ? `–${fmtTime(order.pickup_to)}` : ''}` : '—')}</span>
          </div>
          <div className="bid-top-right">
            <span className={`pill ${order.status === 'open' ? 'deschisa' : ''}`}>{statusLabel(order.status, lang)}</span>
            {isRecentlyNew(order.created_at) && <span className="new-dot">{t('newBadge', lang)}</span>}
          </div>
        </div>
        {existingBid && (
          <div className="geboten-row">
            <span className="pill geboten">✓ {t('bidPlaced', lang)}: {existingBid.price} €</span>
          </div>
        )}
        <div className="bid-order-id">{t('orderRef', lang)} {idParts.join(' · ')}</div>
        {order.shipment_type && (
          <div className="shipment-type-row">
            📦 {SHIPMENT_TYPE_LABELS[order.shipment_type] || order.shipment_type}{order.quantity ? ` (${order.quantity}×)` : ''}
          </div>
        )}
        <div className="bid-stop"><span className="addr"><MapPin size={13} strokeWidth={1.8} /> {order.pickup_address}</span>{order.km && <span className="val">{order.km} km</span>}</div>
        <div className="bid-stop"><span className="addr"><FlagTriangleRight size={13} strokeWidth={1.8} /> {order.delivery_address}</span>{order.weight && <span className="val">⚖ {order.weight} kg</span>}</div>
        <VehicleChips vehicles={order.vehicles} />
      </div>

      <div className="bid-card2-body">
        <div className="bid-body-inner">
          <div className="bid-divider" />
          <div className="bid-zustellung-label">{t('delivery', lang)}</div>
          <div className="bid-zustellung-val">
            {order.delivery_fixed ? (
              <span className="fixed-time-badge">🔒 {t('fixedDeliveryBadge', lang)} · {fmtDate(order.delivery_date)}{order.delivery_time ? ` · ${fmtTime(order.delivery_time)}` : ''}</span>
            ) : (
              <>{fmtDate(order.delivery_date)} · {fmtTime(order.delivery_from)}{order.delivery_to ? `–${fmtTime(order.delivery_to)}` : ''}</>
            )}
          </div>

          {order.dims && (
            <div className="bid-extra-row">📐 {order.dims} cm</div>
          )}

          {extractServiceBadges(order.notes).length > 0 && (
            <div className="service-badges">
              {extractServiceBadges(order.notes).map(({ icon, key }) => (
                <span key={key} className="service-badge">{icon} {t(key, lang)}</span>
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
