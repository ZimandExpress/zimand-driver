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
    biddingPlaceholder: 'Verfügbare Aufträge zum direkten Bieten.',
    earningsPlaceholder: 'Deine Beträge, pro Tag und pro Zeitraum.',
    accountLabel: 'Konto',
    typeLabel: 'Typ',
    typeOwnerOperator: 'Eigene Firma',
    typeEmployee: 'Angestellter Fahrer',
    onlineToggle: 'Online für Disponent',
    onlineToggleNote: 'Solange aktiv, sieht der Disponent deine Position live — auch ohne laufende Fahrt',
    noRides: 'Aktuell keine zugewiesenen Fahrten.',
    loadingRides: 'Fahrten werden geladen…',
    pickup: 'Abholung',
    delivery: 'Lieferung',
    statusNew: 'Neu',
    statusInProgress: 'Läuft',
    statusDone: 'Erledigt',
    vehicleShort: 'Fzg.',
    orderRef: 'Auftrag',
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
    biddingPlaceholder: 'Available orders to bid on directly.',
    earningsPlaceholder: 'Your amounts, per day and per period.',
    accountLabel: 'Account',
    typeLabel: 'Type',
    typeOwnerOperator: 'Owner-operator',
    typeEmployee: 'Employee driver',
    onlineToggle: 'Online for dispatch',
    onlineToggleNote: 'While active, dispatch sees your position live — even without an ongoing ride',
    noRides: 'No assigned rides right now.',
    loadingRides: 'Loading rides…',
    pickup: 'Pickup',
    delivery: 'Delivery',
    statusNew: 'New',
    statusInProgress: 'In progress',
    statusDone: 'Done',
    vehicleShort: 'Vehicle',
    orderRef: 'Order',
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
