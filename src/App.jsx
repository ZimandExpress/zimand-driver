import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import './index.css'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

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
    // drivers table (existing, extended): auth_user_id links to this login,
    // account_type is 'owner_operator' or 'employee', plus is_online / last_lat / last_lng for tracking
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

  if (loading) return <SplashScreen />
  if (!session) return <LoginScreen />
  return <DriverShell session={session} profile={profile} />
}

function SplashScreen() {
  return (
    <div className="phone-shell center-content">
      <div className="brand-mark">
        <span className="live-dot" /> Zimand Driver
      </div>
    </div>
  )
}

function LoginScreen() {
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
    if (error) setError('Email sau parolă greșită.')
  }

  return (
    <div className="phone-shell center-content">
      <div className="login-card">
        <div className="brand-mark"><span className="live-dot" /> Zimand Driver</div>
        <p className="login-sub">Autentifică-te cu contul primit de la dispecerat</p>
        <form onSubmit={handleLogin}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <label>Parolă</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <div className="login-error">{error}</div>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Se conectează…' : 'Conectare'}
          </button>
        </form>
      </div>
    </div>
  )
}

function DriverShell({ session, profile }) {
  const [tab, setTab] = useState('curse')
  const isOwner = profile?.account_type === 'owner_operator'

  return (
    <div className="phone-shell">
      <div className="topbar">
        <div className="brand-mark"><span className="live-dot" /> Zimand Driver</div>
        <button className="logout-btn" onClick={() => supabase.auth.signOut()}>Ieși din cont</button>
      </div>

      <div className="screen-body">
        {tab === 'curse' && <PlaceholderScreen title="Curse" note="Aici vine lista de comenzi live din Supabase — sprintul următor." />}
        {tab === 'licitatii' && isOwner && <PlaceholderScreen title="Licitații" note="Comenzi disponibile pentru licitare directă." />}
        {tab === 'castiguri' && isOwner && <PlaceholderScreen title="Câștiguri" note="Sumele tale, per zi și per perioadă." />}
        {tab === 'profil' && (
          <PlaceholderScreen
            title="Profil"
            note={`Cont: ${profile?.name || session.user.email} · Tip: ${isOwner ? 'Firmă proprie' : 'Șofer angajat'}`}
          />
        )}
      </div>

      <div className="bottomnav">
        <button className={tab === 'curse' ? 'active' : ''} onClick={() => setTab('curse')}>Curse</button>
        {isOwner && <button className={tab === 'licitatii' ? 'active' : ''} onClick={() => setTab('licitatii')}>Licitații</button>}
        {isOwner && <button className={tab === 'castiguri' ? 'active' : ''} onClick={() => setTab('castiguri')}>Câștiguri</button>}
        <button className={tab === 'profil' ? 'active' : ''} onClick={() => setTab('profil')}>Profil</button>
      </div>
    </div>
  )
}

function PlaceholderScreen({ title, note }) {
  return (
    <div className="placeholder-screen">
      <h2>{title}</h2>
      <p>{note}</p>
    </div>
  )
}
