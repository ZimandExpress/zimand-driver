import { useEffect, useState } from 'react'
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

  if (loading) return <SplashScreen lang={lang} />
  if (!session) return <LoginScreen lang={lang} onChangeLang={changeLang} />
  return <DriverShell session={session} profile={profile} lang={lang} onChangeLang={changeLang} />
}

function LangSwitcher({ lang, onChangeLang, dark }) {
  return (
    <div className={`lang-switch ${dark ? 'dark' : ''}`}>
      {availableLangs.map((l) => (
        <button
          key={l}
          className={l === lang ? 'active' : ''}
          onClick={() => onChangeLang(l)}
        >
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

function DriverShell({ session, profile, lang, onChangeLang }) {
  const [tab, setTab] = useState('curse')
  const isOwner = profile?.account_type === 'owner_operator'

  return (
    <div className="phone-shell">
      <div className="topbar">
        <div className="brand-mark"><span className="live-dot" /> {t('appName', lang)}</div>
        <div className="topbar-right">
          <LangSwitcher lang={lang} onChangeLang={onChangeLang} dark />
          <button className="logout-btn" onClick={() => supabase.auth.signOut()}>{t('logout', lang)}</button>
        </div>
      </div>

      <div className="screen-body">
        {tab === 'curse' && <PlaceholderScreen title={t('tabRides', lang)} note={t('ridesPlaceholder', lang)} />}
        {tab === 'licitatii' && isOwner && <PlaceholderScreen title={t('tabBidding', lang)} note={t('biddingPlaceholder', lang)} />}
        {tab === 'castiguri' && isOwner && <PlaceholderScreen title={t('tabEarnings', lang)} note={t('earningsPlaceholder', lang)} />}
        {tab === 'profil' && (
          <PlaceholderScreen
            title={t('tabProfile', lang)}
            note={`${t('accountLabel', lang)}: ${profile?.name || session.user.email} · ${t('typeLabel', lang)}: ${isOwner ? t('typeOwnerOperator', lang) : t('typeEmployee', lang)}`}
          />
        )}
      </div>

      <div className="bottomnav">
        <button className={tab === 'curse' ? 'active' : ''} onClick={() => setTab('curse')}>{t('tabRides', lang)}</button>
        {isOwner && <button className={tab === 'licitatii' ? 'active' : ''} onClick={() => setTab('licitatii')}>{t('tabBidding', lang)}</button>}
        {isOwner && <button className={tab === 'castiguri' ? 'active' : ''} onClick={() => setTab('castiguri')}>{t('tabEarnings', lang)}</button>}
        <button className={tab === 'profil' ? 'active' : ''} onClick={() => setTab('profil')}>{t('tabProfile', lang)}</button>
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
