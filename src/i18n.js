const translations = {
  de: {
    appName: 'Zimand Driver',
    loginSubtitle: 'Melde dich mit deinem Konto vom Disponenten an',
    email: 'E-Mail',
    password: 'Passwort',
    loginButton: 'Anmelden',
    loggingIn: 'Anmeldung läuft…',
    loginError: 'E-Mail oder Passwort falsch.',
    logout: 'Abmelden',
    tabRides: 'Fahrten',
    tabBidding: 'Ausschreibungen',
    tabEarnings: 'Verdienst',
    tabProfile: 'Profil',
    ridesPlaceholder: 'Hier erscheinen live die zugewiesenen Aufträge — nächster Sprint.',
    biddingPlaceholder: 'Verfügbare Aufträge zum direkten Bieten.',
    earningsPlaceholder: 'Deine Beträge, pro Tag und pro Zeitraum.',
    accountLabel: 'Konto',
    typeLabel: 'Typ',
    typeOwnerOperator: 'Eigene Firma',
    typeEmployee: 'Angestellter Fahrer',
  },
  en: {
    appName: 'Zimand Driver',
    loginSubtitle: 'Sign in with the account provided by dispatch',
    email: 'Email',
    password: 'Password',
    loginButton: 'Sign in',
    loggingIn: 'Signing in…',
    loginError: 'Wrong email or password.',
    logout: 'Sign out',
    tabRides: 'Rides',
    tabBidding: 'Bidding',
    tabEarnings: 'Earnings',
    tabProfile: 'Profile',
    ridesPlaceholder: 'Live assigned orders will appear here — next sprint.',
    biddingPlaceholder: 'Available orders to bid on directly.',
    earningsPlaceholder: 'Your amounts, per day and per period.',
    accountLabel: 'Account',
    typeLabel: 'Type',
    typeOwnerOperator: 'Owner-operator',
    typeEmployee: 'Employee driver',
  },
}

const STORAGE_KEY = 'zimand-driver-lang'

export function getLang() {
  const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  return saved && translations[saved] ? saved : 'de'
}

export function setLang(lang) {
  if (typeof window !== 'undefined' && translations[lang]) {
    localStorage.setItem(STORAGE_KEY, lang)
  }
}

export function t(key, lang) {
  const dict = translations[lang] || translations.de
  return dict[key] || translations.de[key] || key
}

export const availableLangs = Object.keys(translations)
