import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { t, getLang, setLang, availableLangs } from './i18n'
import './index.css'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lang, setLangState] = useState(getLang())

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
      .then(({ data, error }) => {
        if (error) console.error('drivers fetch error:', error.message)
        setProfile(data || null)
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

  if (loading) return <SplashScreen lang={lang} />
  if (!session) return <LoginScreen lang={lang} onChangeLang={changeLang} />
  return (
    <DriverShell
      session={session}
      profile={profile}
      onProfileChange={refreshProfile}
      lang={lang}
      onChangeLang={changeLang}
    />
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

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(t('loginError', lang))
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
      </div>
    </div>
  )
}

function DriverShell({ session, profile, onProfileChange, lang, onChangeLang }) {
  const [tab, setTab] = useState('curse')
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

  return (
    <div className="phone-shell">
      <div className="topbar">
        <div className="brand-mark"><span className="live-dot" /> {t('appName', lang)}</div>
        <div className="topbar-right">
          <LangSwitcher lang={lang} onChangeLang={onChangeLang} dark />
          <button className="logout-btn" onClick={() => supabase.auth.signOut()}>{t('logout', lang)}</button>
          <div className="avatar">{initials(profile?.name || session.user.email)}</div>
        </div>
      </div>

      <div className="screen-body">
        {tab === 'curse' && <RidesScreen profile={profile} lang={lang} />}
        {tab === 'licitatii' && isOwner && <PlaceholderScreen title={t('tabBidding', lang)} note={t('biddingPlaceholder', lang)} />}
        {tab === 'castiguri' && isOwner && <PlaceholderScreen title={t('tabEarnings', lang)} note={t('earningsPlaceholder', lang)} />}
        {tab === 'profil' && (
          <ProfileScreen
            session={session}
            profile={profile}
            isOwner={isOwner}
            lang={lang}
            onProfileChange={onProfileChange}
          />
        )}
      </div>

      <div className="bottomnav">
        <button className={tab === 'curse' ? 'active' : ''} onClick={() => setTab('curse')}>
          <span className="nav-ic">🚚</span>{t('tabRides', lang)}
        </button>
        {isOwner && (
          <button className={tab === 'licitatii' ? 'active' : ''} onClick={() => setTab('licitatii')}>
            <span className="nav-ic">🏷️</span>{t('tabBidding', lang)}
          </button>
        )}
        {isOwner && (
          <button className={tab === 'castiguri' ? 'active' : ''} onClick={() => setTab('castiguri')}>
            <span className="nav-ic">💶</span>{t('tabEarnings', lang)}
          </button>
        )}
        <button className={tab === 'profil' ? 'active' : ''} onClick={() => setTab('profil')}>
          <span className="nav-ic">👤</span>{t('tabProfile', lang)}
        </button>
      </div>
    </div>
  )
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

function RidesScreen({ profile, lang }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)

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
      .order('pickup_date', { ascending: true })
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

  if (orders.length === 0) {
    return <PlaceholderScreen title={t('tabRides', lang)} note={t('noRides', lang)} />
  }

  const selected = orders.find((o) => o.id === selectedId)
  if (selected) {
    return <RideDetailScreen order={selected} lang={lang} onBack={() => setSelectedId(null)} onStatusChange={() => setSelectedId(null)} />
  }

  return (
    <div className="rides-list">
      <h2 className="screen-title">{t('tabRides', lang)}</h2>
      {orders.map((o) => (
        <div className="ride-card" key={o.id} onClick={() => setSelectedId(o.id)}>
          <div className="ride-top">
            <span className="ride-ref">{t('orderRef', lang)} {o.order_number || o.reference || o.id.slice(0, 8)}</span>
            <span className={`ride-badge ${statusClass(o.status)}`}>
              {statusLabel(o.status, lang)}
            </span>
          </div>
          <div className="ride-route">
            <div className="ride-stop">
              <span className="ride-stop-label">{t('pickup', lang)}</span>
              <span className="ride-stop-addr">{o.pickup_address}</span>
              {o.pickup_date && (
                <span className="ride-stop-time">
                  {o.pickup_date}{o.pickup_from ? ` · ${o.pickup_from}` : ''}{o.pickup_to ? `–${o.pickup_to}` : ''}
                </span>
              )}
            </div>
            <div className="ride-stop">
              <span className="ride-stop-label">{t('delivery', lang)}</span>
              <span className="ride-stop-addr">{o.delivery_address}</span>
              {o.delivery_date && (
                <span className="ride-stop-time">
                  {o.delivery_date}{o.delivery_from ? ` · ${o.delivery_from}` : ''}{o.delivery_to ? `–${o.delivery_to}` : ''}
                </span>
              )}
            </div>
          </div>
          {o.cargo_desc && <div className="ride-cargo">{o.cargo_desc}</div>}
        </div>
      ))}
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

function RideDetailScreen({ order, lang, onBack, onStatusChange }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const pickupCoords = useGeocode(order.pickup_address)
  const deliveryCoords = useGeocode(order.delivery_address)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return
    mapInstanceRef.current = window.L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([49.45, 11.07], 9)
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(mapInstanceRef.current)
    return () => {
      mapInstanceRef.current?.remove()
      mapInstanceRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    map.eachLayer((layer) => {
      if (layer instanceof window.L.Marker || layer instanceof window.L.Polyline) map.removeLayer(layer)
    })

    const points = []
    if (pickupCoords) {
      const icon = window.L.divIcon({ className: '', html: '<div class="pin-icon pk"><span>A</span></div>', iconSize: [22, 22], iconAnchor: [11, 20] })
      window.L.marker(pickupCoords, { icon }).addTo(map)
      points.push(pickupCoords)
    }
    if (deliveryCoords) {
      const icon = window.L.divIcon({ className: '', html: '<div class="pin-icon dl"><span>B</span></div>', iconSize: [22, 22], iconAnchor: [11, 20] })
      window.L.marker(deliveryCoords, { icon }).addTo(map)
      points.push(deliveryCoords)
    }
    if (points.length === 2) {
      window.L.polyline(points, { color: '#FF7A29', weight: 3, dashArray: '1,8' }).addTo(map)
      map.fitBounds(window.L.latLngBounds(points), { padding: [30, 30] })
    } else if (points.length === 1) {
      map.setView(points[0], 12)
    }
  }, [pickupCoords, deliveryCoords])

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

      <div className="live-map">
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {order.status === 'assigned' && !confirmedAt && (
        <LegWorkflow order={order} leg={leg} lang={lang} startedAt={startedAt} arrivedAt={arrivedAt} onStatusChange={onStatusChange} />
      )}

      {order.status === 'assigned' && order.pickup_confirmed_at && !order.delivery_confirmed_at && leg === 'delivery' && null}

      <div className="info-card">
        <div className="info-card-head">🅐 {t('pickup', lang)}</div>
        <div className="info-card-body">
          <div className="info-row"><span>{order.pickup_address}</span></div>
          {order.pickup_date && (
            <div className="info-row-time">
              {order.pickup_date}{order.pickup_from ? ` · ${order.pickup_from}` : ''}{order.pickup_to ? `–${order.pickup_to}` : ''}
            </div>
          )}
          {order.pickup_confirmed_at && <div className="info-row-time">✓ {new Date(order.pickup_confirmed_at).toLocaleString()}</div>}
        </div>
      </div>

      <div className="info-card">
        <div className="info-card-head">🅑 {t('delivery', lang)}</div>
        <div className="info-card-body">
          <div className="info-row"><span>{order.delivery_address}</span></div>
          {order.delivery_date && (
            <div className="info-row-time">
              {order.delivery_date}{order.delivery_from ? ` · ${order.delivery_from}` : ''}{order.delivery_to ? `–${order.delivery_to}` : ''}
            </div>
          )}
          {order.delivery_confirmed_at && <div className="info-row-time">✓ {new Date(order.delivery_confirmed_at).toLocaleString()}</div>}
        </div>
      </div>

      <div className="info-card">
        <div className="info-card-head">📦 {t('cargoLabel', lang)}</div>
        <div className="info-card-body">
          {order.cargo_desc && <div className="info-row"><span className="k">{t('cargoLabel', lang)}</span><span className="v">{order.cargo_desc}</span></div>}
          {order.weight && <div className="info-row"><span className="k">{t('weightLabel', lang)}</span><span className="v">{order.weight} kg</span></div>}
          {order.dims && <div className="info-row"><span className="k">{t('dimsLabel', lang)}</span><span className="v">{order.dims}</span></div>}
          {order.km && <div className="info-row"><span className="k">{t('kmLabel', lang)}</span><span className="v">{order.km} km</span></div>}
          {order.reference && <div className="info-row"><span className="k">{t('referenceLabel', lang)}</span><span className="v">{order.reference}</span></div>}
          {order.notes && <div className="info-note">{order.notes}</div>}
        </div>
      </div>
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
  const [cmrFile, setCmrFile] = useState(null)
  const fileInputRef = useRef(null)
  const cmrInputRef = useRef(null)

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

  async function confirmLeg() {
    setBusy(true)
    try {
      const photoPaths = []
      for (const file of photos) {
        photoPaths.push(await uploadPodFile(order.id, leg, file))
      }
      let cmrPath = null
      if (cmrFile) {
        cmrPath = await uploadPodFile(order.id, leg, cmrFile)
      }
      const { error } = await supabase.rpc(confirmFn, { p_order_id: order.id, p_photos: photoPaths, p_cmr_url: cmrPath })
      if (error) throw error
      onStatusChange()
    } catch (err) {
      console.error('confirm leg error:', err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!startedAt) {
    return (
      <div className="leg-workflow">
        <div className="leg-title">{legLabel}</div>
        <button className="btn" onClick={() => callRpc(startFn)} disabled={busy}>
          {t('startDriving', lang)}
        </button>
      </div>
    )
  }

  if (!arrivedAt) {
    return (
      <div className="leg-workflow">
        <div className="leg-title">{legLabel}</div>
        <ElapsedTimer startedAt={startedAt} />
        <button className="btn" onClick={() => callRpc(arriveFn)} disabled={busy}>
          {t('arrived', lang)}
        </button>
      </div>
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

      <div className="pod-label">{t('cmrLabel', lang)}</div>
      {cmrFile ? (
        <div className="cmr-chip" onClick={() => setCmrFile(null)}>{cmrFile.name} ✕</div>
      ) : (
        <button className="btn secondary" onClick={() => cmrInputRef.current?.click()}>{t('uploadCmr', lang)}</button>
      )}
      <input
        ref={cmrInputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => setCmrFile(e.target.files?.[0] || null)}
      />

      <button className="btn" onClick={confirmLeg} disabled={busy} style={{ marginTop: 14 }}>
        {busy ? '…' : leg === 'pickup' ? t('confirmPickup', lang) : t('confirmDelivery', lang)}
      </button>
    </div>
  )
}

function ProfileScreen({ session, profile, isOwner, lang, onProfileChange }) {
  const [busy, setBusy] = useState(false)
  const isOnline = !!profile?.is_online

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

  return (
    <div className="placeholder-screen">
      <h2>{t('tabProfile', lang)}</h2>
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
