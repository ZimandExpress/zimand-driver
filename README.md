# Zimand Driver — sprint 1 (auth + schelet)

Ce conține acest sprint:
- Ecran de login (email + parolă) conectat la același proiect Supabase folosit de partner/disponent
- După autentificare, aplicația citește profilul șoferului din tabela `driver_profiles` și decide dacă arată tab-urile de owner-operator (Licitații, Câștiguri) sau doar cele de bază (Curse, Profil)
- Ecrane placeholder pentru Curse / Licitații / Câștiguri / Profil — se umplu cu date reale în sprinturile următoare

## 1. Pune codul pe GitHub

Creează un repo nou, gol, numit `zimand-driver` sub contul `ZimandExpress` (la fel ca `zimand-auftragsportal`).
Apoi încarcă toate fișierele din acest folder (drag & drop pe GitHub e suficient pentru primul commit).

## 2. Tabela de șoferi (deja făcut ✓)

Nu am creat un tabel nou — am extins tabelul `drivers` existent (cel folosit deja de partner.zimandexpress.de)
cu coloanele necesare pentru login și tracking live:

```sql
alter table drivers
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists account_type text default 'employee' check (account_type in ('owner_operator', 'employee')),
  add column if not exists phone text,
  add column if not exists is_online boolean default false,
  add column if not exists last_lat double precision,
  add column if not exists last_lng double precision,
  add column if not exists last_location_at timestamptz;

create index if not exists drivers_auth_user_id_idx on drivers(auth_user_id);

alter table drivers enable row level security;

create policy "driver reads own row"
  on drivers for select
  using (auth.uid() = auth_user_id);

create policy "driver updates own row"
  on drivers for update
  using (auth.uid() = auth_user_id);
```

### Cum creezi primul cont de șofer de test

1. Supabase → Authentication → Users → "Add user" → completezi email + parolă → Create user
2. Copiezi UUID-ul contului nou creat (coloana `UID` din lista de useri)
3. În tabelul `drivers` (Table Editor), fie editezi un rând existent, fie creezi unul nou, și completezi:
   - `auth_user_id` = UUID-ul copiat la pasul 2
   - `account_type` = `owner_operator` sau `employee`
   - `company_id` = id-ul firmei din `profiles` (dacă e șofer angajat al unei firme existente)
4. Te loghezi în Zimand Driver cu emailul + parola de la pasul 1

## 3. Variabile de mediu

Copiază `.env.example` în `.env.local` și completează:

```
VITE_SUPABASE_URL=https://vayshseythlogtumefzq.supabase.co
VITE_SUPABASE_ANON_KEY=<cheia anon din Supabase → Settings → API>
```

## 4. Deploy pe Vercel

Conectează repo-ul `zimand-driver` la Vercel (Import Project → alege repo-ul), adaugă cele două variabile de mediu
de mai sus în Vercel → Settings → Environment Variables, apoi Deploy. Domeniu recomandat: `driver.zimandexpress.de`.

## Rulare locală (opțional, pentru testare înainte de deploy)

```
npm install
npm run dev
```

## Cum o folosești acum pe telefon, înainte de Play Store / App Store

Odată publicată pe Vercel, deschizi link-ul (ex. `driver.zimandexpress.de`) direct din browserul telefonului:

- **Android (Chrome):** meniul ⋮ → "Adaugă pe ecranul principal" / "Instalează aplicația"
- **iPhone (Safari):** butonul de share (pătratul cu săgeata în sus) → "Add to Home Screen"

Aplicația apare cu propria iconiță (cea din `public/icon-192.png`), se deschide pe tot ecranul, fără bara de browser —
practic identic cu o aplicație descărcată din magazin, doar că fără procesul de review. Șoferii pot începe s-o
folosească așa chiar din primele sprinturi, iar publicarea pe cele două magazine rămâne un pas separat, pentru
mai târziu, când aplicația e stabilă.

## 5. Iconițele aplicației

Sunt deja generate în `public/` (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`), în stilul navy/orange.
Le poți înlocui oricând cu un logo definitiv — păstrează aceleași nume de fișier și dimensiuni.

## Ce urmează (sprintul 2)

- Tabelul `driver_locations` + trimiterea poziției GPS cât timp șoferul e "Online"
- Ecranul Curse conectat la comenzile reale + harta live (Leaflet) pe detaliul cursei
- Panoul de flotă live pe disponent.zimandexpress.de
