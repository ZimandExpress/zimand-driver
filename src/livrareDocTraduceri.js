// Livrarea de documente — textele noi (05.11.2026, cerut de Andrei).
//
// Regula, pe scurt: cutia poştală NUMAI dacă acelaşi nume de familie e pe cutie
// şi pe plic; altfel nu se aruncă — se contactează dispeceratul Zimand Express.
// Niciodată altor persoane. Înlocuiesc paşii din PASI_ZUSTELLART (aceleaşi
// chei v1 / v2 / v3), deci şi cardul comenzii arată acelaşi lucru.
//
// Partea dinainte de „:" se scrie îngroşat.
//
// ZP_PAGINA: a doua pagină de la sosire — ce se completează pe Zustellprotokoll.
// Etichetele de pe formular rămân în germană (aşa scrie pe hârtie); `h` sunt
// explicaţiile în limba şoferului, în aceeaşi ordine ca rubricile desenate:
//   0 Anzahl zugestellter Umschläge · 1 Briefkasten / persönlich ankreuzen ·
//   2 Name am Briefkasten bzw. Name + Unterschrift Empfänger ·
//   3 Datum + Uhrzeit · 4 Ort · 5 Name + Unterschrift Kurier

export const PASI_ZUSTELLART_V2 = {
  de: {
    v1: ['Briefkasten: nur wenn derselbe Nachname auf dem Briefkasten und auf dem Umschlag steht.', 'Fotos: Namensschild und Umschlag beim Einwerfen – gut lesbar.', 'Kein passender Name: nicht einwerfen – Zimand Express Disposition kontaktieren.', 'Verboten: Übergabe an Familie, Nachbarn oder Kollegen.'],
    v2: ['Zuerst: persönlich an den Empfänger übergeben.', 'Nicht möglich: Briefkasten – nur wenn derselbe Nachname auf Briefkasten und Umschlag steht. Namensschild und Umschlag fotografieren.', 'Kein passender Name: nicht einwerfen – Zimand Express Disposition kontaktieren.', 'Verboten: Übergabe an Familie, Nachbarn oder Kollegen.'],
    v3: ['Nur: persönlich an den Empfänger – kein Briefkasten.', 'Empfänger nicht da: Umschlag NICHT dalassen – Zimand Express Disposition kontaktieren.', 'Verboten: Übergabe an Familie, Nachbarn oder Kollegen.'],
  },
  en: {
    v1: ['Letterbox: only if the same surname is on the letterbox and on the envelope.', 'Photos: the name plate and the envelope as you post it – clearly readable.', 'No matching name: do not post it – contact Zimand Express dispatch.', 'Forbidden: handing it to family, neighbours or colleagues.'],
    v2: ['First: hand it to the recipient in person.', 'Not possible: letterbox – only if the same surname is on the letterbox and the envelope. Photograph the name plate and the envelope.', 'No matching name: do not post it – contact Zimand Express dispatch.', 'Forbidden: handing it to family, neighbours or colleagues.'],
    v3: ['Only: in person to the recipient – no letterbox.', 'Recipient not there: do NOT leave the envelope – contact Zimand Express dispatch.', 'Forbidden: handing it to family, neighbours or colleagues.'],
  },
  ro: {
    v1: ['Cutia poștală: doar dacă același nume de familie e pe cutie și pe plic.', 'Poze: plăcuța cu numele și plicul în timp ce îl introduceți – să se citească clar.', 'Numele nu corespunde: nu introduceți plicul – contactați dispeceratul Zimand Express.', 'Interzis: predarea către familie, vecini sau colegi.'],
    v2: ['Întâi: predare personală destinatarului.', 'Dacă nu se poate: cutia poștală – doar dacă același nume de familie e pe cutie și pe plic. Fotografiați plăcuța și plicul.', 'Numele nu corespunde: nu introduceți plicul – contactați dispeceratul Zimand Express.', 'Interzis: predarea către familie, vecini sau colegi.'],
    v3: ['Doar: predare personală destinatarului – fără cutie poștală.', 'Destinatarul nu e acolo: NU lăsați plicul – contactați dispeceratul Zimand Express.', 'Interzis: predarea către familie, vecini sau colegi.'],
  },
  pl: {
    v1: ['Skrzynka pocztowa: tylko jeśli to samo nazwisko jest na skrzynce i na kopercie.', 'Zdjęcia: tabliczka z nazwiskiem i koperta przy wrzucaniu – czytelnie.', 'Brak zgodnego nazwiska: nie wrzucać – skontaktuj się z dyspozytornią Zimand Express.', 'Zakaz: przekazanie rodzinie, sąsiadom lub kolegom.'],
    v2: ['Najpierw: osobiście do rąk odbiorcy.', 'Jeśli się nie da: skrzynka – tylko jeśli to samo nazwisko jest na skrzynce i kopercie. Sfotografuj tabliczkę i kopertę.', 'Brak zgodnego nazwiska: nie wrzucać – skontaktuj się z dyspozytornią Zimand Express.', 'Zakaz: przekazanie rodzinie, sąsiadom lub kolegom.'],
    v3: ['Tylko: osobiście do rąk odbiorcy – bez skrzynki.', 'Odbiorcy nie ma: NIE zostawiaj koperty – skontaktuj się z dyspozytornią Zimand Express.', 'Zakaz: przekazanie rodzinie, sąsiadom lub kolegom.'],
  },
  bg: {
    v1: ['Пощенска кутия: само ако една и съща фамилия е на кутията и на плика.', 'Снимки: табелката с името и пликът при пускането – четливо.', 'Няма съвпадащо име: не пускайте плика – свържете се с диспечерите на Zimand Express.', 'Забранено: предаване на семейство, съседи или колеги.'],
    v2: ['Първо: лично предаване на получателя.', 'Ако не е възможно: пощенска кутия – само ако една и съща фамилия е на кутията и плика. Снимайте табелката и плика.', 'Няма съвпадащо име: не пускайте плика – свържете се с диспечерите на Zimand Express.', 'Забранено: предаване на семейство, съседи или колеги.'],
    v3: ['Само: лично на получателя – без пощенска кутия.', 'Получателят го няма: НЕ оставяйте плика – свържете се с диспечерите на Zimand Express.', 'Забранено: предаване на семейство, съседи или колеги.'],
  },
  hu: {
    v1: ['Postaláda: csak ha ugyanaz a vezetéknév áll a postaládán és a borítékon.', 'Fotók: a névtábla és a boríték bedobáskor – jól olvashatóan.', 'Nincs egyező név: ne dobja be – keresse a Zimand Express diszpécsert.', 'Tilos: átadás családtagnak, szomszédnak vagy kollégának.'],
    v2: ['Először: személyes átadás a címzettnek.', 'Ha nem lehetséges: postaláda – csak ha ugyanaz a vezetéknév áll a postaládán és a borítékon. Fotózza le a névtáblát és a borítékot.', 'Nincs egyező név: ne dobja be – keresse a Zimand Express diszpécsert.', 'Tilos: átadás családtagnak, szomszédnak vagy kollégának.'],
    v3: ['Csak: személyesen a címzettnek – postaláda nélkül.', 'A címzett nincs ott: NE hagyja ott a borítékot – keresse a Zimand Express diszpécsert.', 'Tilos: átadás családtagnak, szomszédnak vagy kollégának.'],
  },
  cs: {
    v1: ['Schránka: jen pokud je stejné příjmení na schránce i na obálce.', 'Fotky: jmenovka a obálka při vhazování – čitelně.', 'Jméno nesouhlasí: nevhazovat – kontaktujte dispečink Zimand Express.', 'Zakázáno: předání rodině, sousedům nebo kolegům.'],
    v2: ['Nejprve: osobně do rukou příjemce.', 'Nejde to: schránka – jen pokud je stejné příjmení na schránce i obálce. Vyfoťte jmenovku a obálku.', 'Jméno nesouhlasí: nevhazovat – kontaktujte dispečink Zimand Express.', 'Zakázáno: předání rodině, sousedům nebo kolegům.'],
    v3: ['Pouze: osobně příjemci – žádná schránka.', 'Příjemce není doma: obálku NENECHÁVAT – kontaktujte dispečink Zimand Express.', 'Zakázáno: předání rodině, sousedům nebo kolegům.'],
  },
  sk: {
    v1: ['Schránka: len ak je rovnaké priezvisko na schránke aj na obálke.', 'Fotky: menovka a obálka pri vhadzovaní – čitateľne.', 'Meno nesedí: nevhadzovať – kontaktujte dispečing Zimand Express.', 'Zakázané: odovzdanie rodine, susedom alebo kolegom.'],
    v2: ['Najprv: osobne do rúk príjemcu.', 'Nedá sa: schránka – len ak je rovnaké priezvisko na schránke aj obálke. Odfoťte menovku a obálku.', 'Meno nesedí: nevhadzovať – kontaktujte dispečing Zimand Express.', 'Zakázané: odovzdanie rodine, susedom alebo kolegom.'],
    v3: ['Len: osobne príjemcovi – žiadna schránka.', 'Príjemca nie je doma: obálku NENECHÁVAŤ – kontaktujte dispečing Zimand Express.', 'Zakázané: odovzdanie rodine, susedom alebo kolegom.'],
  },
  hr: {
    v1: ['Poštanski sandučić: samo ako je isto prezime na sandučiću i na omotnici.', 'Fotografije: pločica s imenom i omotnica pri ubacivanju – čitljivo.', 'Ime se ne podudara: ne ubacivati – kontaktirajte dispečerski centar Zimand Express.', 'Zabranjeno: predaja obitelji, susjedima ili kolegama.'],
    v2: ['Prvo: osobna predaja primatelju.', 'Ako nije moguće: sandučić – samo ako je isto prezime na sandučiću i omotnici. Fotografirajte pločicu i omotnicu.', 'Ime se ne podudara: ne ubacivati – kontaktirajte dispečerski centar Zimand Express.', 'Zabranjeno: predaja obitelji, susjedima ili kolegama.'],
    v3: ['Samo: osobno primatelju – bez sandučića.', 'Primatelj nije tu: NE ostavljati omotnicu – kontaktirajte dispečerski centar Zimand Express.', 'Zabranjeno: predaja obitelji, susjedima ili kolegama.'],
  },
  sr: {
    v1: ['Poštansko sanduče: samo ako je isto prezime na sandučetu i na koverti.', 'Fotografije: pločica sa imenom i koverta pri ubacivanju – čitljivo.', 'Ime se ne poklapa: ne ubacivati – kontaktirajte dispečere Zimand Express.', 'Zabranjeno: predaja porodici, komšijama ili kolegama.'],
    v2: ['Prvo: lična predaja primaocu.', 'Ako nije moguće: sanduče – samo ako je isto prezime na sandučetu i koverti. Fotografišite pločicu i kovertu.', 'Ime se ne poklapa: ne ubacivati – kontaktirajte dispečere Zimand Express.', 'Zabranjeno: predaja porodici, komšijama ili kolegama.'],
    v3: ['Samo: lično primaocu – bez sandučeta.', 'Primalac nije tu: NE ostavljati kovertu – kontaktirajte dispečere Zimand Express.', 'Zabranjeno: predaja porodici, komšijama ili kolegama.'],
  },
  sl: {
    v1: ['Poštni nabiralnik: samo če je isti priimek na nabiralniku in na ovojnici.', 'Fotografije: tablica z imenom in ovojnica ob vstavljanju – čitljivo.', 'Ime se ne ujema: ne vstavljajte – pokličite dispečerje Zimand Express.', 'Prepovedano: izročitev družini, sosedom ali sodelavcem.'],
    v2: ['Najprej: osebna izročitev prejemniku.', 'Če ni mogoče: nabiralnik – samo če je isti priimek na nabiralniku in ovojnici. Fotografirajte tablico in ovojnico.', 'Ime se ne ujema: ne vstavljajte – pokličite dispečerje Zimand Express.', 'Prepovedano: izročitev družini, sosedom ali sodelavcem.'],
    v3: ['Samo: osebno prejemniku – brez nabiralnika.', 'Prejemnika ni: ovojnice NE puščajte – pokličite dispečerje Zimand Express.', 'Prepovedano: izročitev družini, sosedom ali sodelavcem.'],
  },
  sq: {
    v1: ['Kutia postare: vetëm nëse i njëjti mbiemër është në kuti dhe në zarf.', 'Foto: tabela me emrin dhe zarfi kur e futni – qartë.', 'Emri nuk përputhet: mos e futni – kontaktoni dispeçerinë e Zimand Express.', 'E ndaluar: dorëzimi te familja, fqinjët ose kolegët.'],
    v2: ['Së pari: dorëzim personal te marrësi.', 'Nëse nuk është e mundur: kutia postare – vetëm nëse i njëjti mbiemër është në kuti dhe në zarf. Fotografoni tabelën dhe zarfin.', 'Emri nuk përputhet: mos e futni – kontaktoni dispeçerinë e Zimand Express.', 'E ndaluar: dorëzimi te familja, fqinjët ose kolegët.'],
    v3: ['Vetëm: personalisht te marrësi – pa kuti postare.', 'Marrësi nuk është: MOS e lini zarfin – kontaktoni dispeçerinë e Zimand Express.', 'E ndaluar: dorëzimi te familja, fqinjët ose kolegët.'],
  },
  uk: {
    v1: ['Поштова скринька: лише якщо те саме прізвище на скриньці й на конверті.', 'Фото: табличка з іменем і конверт під час вкидання – чітко.', 'Ім’я не збігається: не вкидати – зв’яжіться з диспетчерською Zimand Express.', 'Заборонено: передавати родині, сусідам чи колегам.'],
    v2: ['Спершу: особисто одержувачу.', 'Якщо неможливо: скринька – лише якщо те саме прізвище на скриньці й конверті. Сфотографуйте табличку й конверт.', 'Ім’я не збігається: не вкидати – зв’яжіться з диспетчерською Zimand Express.', 'Заборонено: передавати родині, сусідам чи колегам.'],
    v3: ['Лише: особисто одержувачу – без скриньки.', 'Одержувача немає: НЕ залишайте конверт – зв’яжіться з диспетчерською Zimand Express.', 'Заборонено: передавати родині, сусідам чи колегам.'],
  },
  ru: {
    v1: ['Почтовый ящик: только если одна и та же фамилия на ящике и на конверте.', 'Фото: табличка с именем и конверт при опускании – чётко.', 'Имя не совпадает: не опускать – свяжитесь с диспетчерской Zimand Express.', 'Запрещено: передавать семье, соседям или коллегам.'],
    v2: ['Сначала: лично получателю.', 'Если невозможно: почтовый ящик – только если одна и та же фамилия на ящике и конверте. Сфотографируйте табличку и конверт.', 'Имя не совпадает: не опускать – свяжитесь с диспетчерской Zimand Express.', 'Запрещено: передавать семье, соседям или коллегам.'],
    v3: ['Только: лично получателю – без почтового ящика.', 'Получателя нет: НЕ оставляйте конверт – свяжитесь с диспетчерской Zimand Express.', 'Запрещено: передавать семье, соседям или коллегам.'],
  },
  tr: {
    v1: ['Posta kutusu: yalnızca kutuda ve zarfta aynı soyadı varsa.', 'Fotoğraflar: isim levhası ve atarken zarf – okunaklı.', 'İsim uyuşmuyor: atmayın – Zimand Express sevk merkezine başvurun.', 'Yasak: aileye, komşulara veya iş arkadaşlarına teslim.'],
    v2: ['Önce: alıcıya elden teslim.', 'Mümkün değilse: posta kutusu – yalnızca kutuda ve zarfta aynı soyadı varsa. Levhayı ve zarfı fotoğraflayın.', 'İsim uyuşmuyor: atmayın – Zimand Express sevk merkezine başvurun.', 'Yasak: aileye, komşulara veya iş arkadaşlarına teslim.'],
    v3: ['Yalnızca: alıcıya elden – posta kutusu yok.', 'Alıcı yok: zarfı BIRAKMAYIN – Zimand Express sevk merkezine başvurun.', 'Yasak: aileye, komşulara veya iş arkadaşlarına teslim.'],
  },
  it: {
    v1: ['Cassetta postale: solo se lo stesso cognome è sulla cassetta e sulla busta.', 'Foto: targhetta con il nome e la busta mentre la inserite – ben leggibili.', 'Nome non corrispondente: non inserire – contattare la centrale Zimand Express.', 'Vietato: consegnare a familiari, vicini o colleghi.'],
    v2: ['Prima: consegna personale al destinatario.', 'Se non è possibile: cassetta postale – solo se lo stesso cognome è sulla cassetta e sulla busta. Fotografare targhetta e busta.', 'Nome non corrispondente: non inserire – contattare la centrale Zimand Express.', 'Vietato: consegnare a familiari, vicini o colleghi.'],
    v3: ['Solo: di persona al destinatario – niente cassetta.', 'Destinatario assente: NON lasciare la busta – contattare la centrale Zimand Express.', 'Vietato: consegnare a familiari, vicini o colleghi.'],
  },
  es: {
    v1: ['Buzón: solo si el mismo apellido figura en el buzón y en el sobre.', 'Fotos: la placa con el nombre y el sobre al echarlo – bien legibles.', 'El nombre no coincide: no echarlo – contacte con el despacho de Zimand Express.', 'Prohibido: entregarlo a familiares, vecinos o compañeros.'],
    v2: ['Primero: entrega en mano al destinatario.', 'Si no es posible: buzón – solo si el mismo apellido figura en el buzón y en el sobre. Fotografíe la placa y el sobre.', 'El nombre no coincide: no echarlo – contacte con el despacho de Zimand Express.', 'Prohibido: entregarlo a familiares, vecinos o compañeros.'],
    v3: ['Solo: en mano al destinatario – sin buzón.', 'El destinatario no está: NO deje el sobre – contacte con el despacho de Zimand Express.', 'Prohibido: entregarlo a familiares, vecinos o compañeros.'],
  },
  fr: {
    v1: ['Boîte aux lettres : seulement si le même nom de famille figure sur la boîte et sur l’enveloppe.', 'Photos : la plaque nominative et l’enveloppe au moment du dépôt – bien lisibles.', 'Nom différent : ne pas déposer – contacter la centrale Zimand Express.', 'Interdit : remettre à la famille, aux voisins ou aux collègues.'],
    v2: ['D’abord : remise en main propre au destinataire.', 'Impossible : boîte aux lettres – seulement si le même nom de famille figure sur la boîte et l’enveloppe. Photographier la plaque et l’enveloppe.', 'Nom différent : ne pas déposer – contacter la centrale Zimand Express.', 'Interdit : remettre à la famille, aux voisins ou aux collègues.'],
    v3: ['Uniquement : en main propre au destinataire – pas de boîte aux lettres.', 'Destinataire absent : NE PAS laisser l’enveloppe – contacter la centrale Zimand Express.', 'Interdit : remettre à la famille, aux voisins ou aux collègues.'],
  },
  pt: {
    v1: ['Caixa de correio: só se o mesmo apelido estiver na caixa e no envelope.', 'Fotos: a placa com o nome e o envelope ao colocá-lo – bem legíveis.', 'Nome não coincide: não colocar – contacte a central da Zimand Express.', 'Proibido: entregar a familiares, vizinhos ou colegas.'],
    v2: ['Primeiro: entrega em mão ao destinatário.', 'Não sendo possível: caixa de correio – só se o mesmo apelido estiver na caixa e no envelope. Fotografe a placa e o envelope.', 'Nome não coincide: não colocar – contacte a central da Zimand Express.', 'Proibido: entregar a familiares, vizinhos ou colegas.'],
    v3: ['Só: em mão ao destinatário – sem caixa de correio.', 'Destinatário ausente: NÃO deixe o envelope – contacte a central da Zimand Express.', 'Proibido: entregar a familiares, vizinhos ou colegas.'],
  },
  nl: {
    v1: ['Brievenbus: alleen als dezelfde achternaam op de brievenbus en op de envelop staat.', 'Foto’s: het naambordje en de envelop bij het posten – goed leesbaar.', 'Naam klopt niet: niet posten – neem contact op met de planning van Zimand Express.', 'Verboden: afgeven aan familie, buren of collega’s.'],
    v2: ['Eerst: persoonlijk aan de ontvanger geven.', 'Niet mogelijk: brievenbus – alleen als dezelfde achternaam op brievenbus en envelop staat. Fotografeer naambordje en envelop.', 'Naam klopt niet: niet posten – neem contact op met de planning van Zimand Express.', 'Verboden: afgeven aan familie, buren of collega’s.'],
    v3: ['Alleen: persoonlijk aan de ontvanger – geen brievenbus.', 'Ontvanger niet thuis: envelop NIET achterlaten – neem contact op met de planning van Zimand Express.', 'Verboden: afgeven aan familie, buren of collega’s.'],
  },
  el: {
    v1: ['Γραμματοκιβώτιο: μόνο αν το ίδιο επώνυμο υπάρχει στο κουτί και στον φάκελο.', 'Φωτογραφίες: η πινακίδα με το όνομα και ο φάκελος τη στιγμή που τον ρίχνετε – ευανάγνωστα.', 'Το όνομα δεν ταιριάζει: μην τον ρίξετε – επικοινωνήστε με το κέντρο της Zimand Express.', 'Απαγορεύεται: παράδοση σε οικογένεια, γείτονες ή συναδέλφους.'],
    v2: ['Πρώτα: προσωπική παράδοση στον παραλήπτη.', 'Αν δεν γίνεται: γραμματοκιβώτιο – μόνο αν το ίδιο επώνυμο υπάρχει στο κουτί και στον φάκελο. Φωτογραφίστε πινακίδα και φάκελο.', 'Το όνομα δεν ταιριάζει: μην τον ρίξετε – επικοινωνήστε με το κέντρο της Zimand Express.', 'Απαγορεύεται: παράδοση σε οικογένεια, γείτονες ή συναδέλφους.'],
    v3: ['Μόνο: προσωπικά στον παραλήπτη – χωρίς γραμματοκιβώτιο.', 'Ο παραλήπτης λείπει: ΜΗΝ αφήσετε τον φάκελο – επικοινωνήστε με το κέντρο της Zimand Express.', 'Απαγορεύεται: παράδοση σε οικογένεια, γείτονες ή συναδέλφους.'],
  },
  lt: {
    v1: ['Pašto dėžutė: tik jei ta pati pavardė yra ant dėžutės ir ant voko.', 'Nuotraukos: lentelė su pavarde ir vokas jį įmetant – aiškiai.', 'Pavardė nesutampa: neįmesti – susisiekite su Zimand Express dispečerine.', 'Draudžiama: perduoti šeimai, kaimynams ar kolegoms.'],
    v2: ['Pirmiausia: asmeniškai gavėjui.', 'Jei neįmanoma: pašto dėžutė – tik jei ta pati pavardė yra ant dėžutės ir voko. Nufotografuokite lentelę ir voką.', 'Pavardė nesutampa: neįmesti – susisiekite su Zimand Express dispečerine.', 'Draudžiama: perduoti šeimai, kaimynams ar kolegoms.'],
    v3: ['Tik: asmeniškai gavėjui – be pašto dėžutės.', 'Gavėjo nėra: NEPALIKITE voko – susisiekite su Zimand Express dispečerine.', 'Draudžiama: perduoti šeimai, kaimynams ar kolegoms.'],
  },
  lv: {
    v1: ['Pastkastīte: tikai tad, ja tas pats uzvārds ir uz pastkastītes un uz aploksnes.', 'Foto: plāksnīte ar vārdu un aploksne, to iemetot – salasāmi.', 'Vārds nesakrīt: neiemest – sazinieties ar Zimand Express dispečeriem.', 'Aizliegts: nodot ģimenei, kaimiņiem vai kolēģiem.'],
    v2: ['Vispirms: personīgi saņēmējam.', 'Ja nav iespējams: pastkastīte – tikai tad, ja tas pats uzvārds ir uz kastītes un aploksnes. Nofotografējiet plāksnīti un aploksni.', 'Vārds nesakrīt: neiemest – sazinieties ar Zimand Express dispečeriem.', 'Aizliegts: nodot ģimenei, kaimiņiem vai kolēģiem.'],
    v3: ['Tikai: personīgi saņēmējam – bez pastkastītes.', 'Saņēmēja nav: aploksni NEATSTĀT – sazinieties ar Zimand Express dispečeriem.', 'Aizliegts: nodot ģimenei, kaimiņiem vai kolēģiem.'],
  },
}

// [Weiter, titlu, intro, după completare, buton final, h0..h5]
const Z = (next, titlu, intro, upload, ok, h) => ({ next, titlu, intro, upload, ok, h })
export const ZP_PAGINA = {
  de: Z('Weiter', 'Zustellprotokoll ausfüllen', 'Vor dem Abschluss prüfen: alle markierten Felder ausgefüllt?', 'Danach das Protokoll fotografieren und unter „Dokument hinzufügen“ hochladen.', 'Verstanden',
    ['Anzahl der Umschläge', 'Ankreuzen: Briefkasten oder persönlich', 'Name am Briefkasten – oder Name und Unterschrift des Empfängers', 'Datum und Uhrzeit', 'Ort', 'Ihr Name und Ihre Unterschrift']),
  en: Z('Next', 'Fill in the Zustellprotokoll', 'Before finishing, check: are all marked fields filled in?', 'Then photograph the protocol and upload it under “Dokument hinzufügen”.', 'Understood',
    ['Number of envelopes', 'Tick: letterbox or in person', 'Name on the letterbox – or the recipient’s name and signature', 'Date and time', 'Place', 'Your name and signature']),
  ro: Z('Mai departe', 'Completați Zustellprotokoll', 'Înainte de finalizare verificați: sunt completate toate câmpurile marcate?', 'Apoi fotografiați protocolul și încărcați-l la „Dokument hinzufügen”.', 'Am înțeles',
    ['Numărul de plicuri', 'Bifați: cutia poștală sau personal', 'Numele de pe cutia poștală – sau numele și semnătura destinatarului', 'Data și ora', 'Localitatea', 'Numele și semnătura dvs.']),
  pl: Z('Dalej', 'Wypełnij Zustellprotokoll', 'Przed zakończeniem sprawdź: czy wszystkie zaznaczone pola są wypełnione?', 'Następnie sfotografuj protokół i prześlij go w „Dokument hinzufügen”.', 'Rozumiem',
    ['Liczba kopert', 'Zaznacz: skrzynka lub osobiście', 'Nazwisko na skrzynce – albo imię, nazwisko i podpis odbiorcy', 'Data i godzina', 'Miejscowość', 'Twoje imię, nazwisko i podpis']),
  bg: Z('Напред', 'Попълнете Zustellprotokoll', 'Преди приключване проверете: попълнени ли са всички отбелязани полета?', 'След това снимайте протокола и го качете в „Dokument hinzufügen“.', 'Разбрах',
    ['Брой пликове', 'Отбележете: пощенска кутия или лично', 'Името на кутията – или името и подписа на получателя', 'Дата и час', 'Населено място', 'Вашето име и подпис']),
  hu: Z('Tovább', 'Zustellprotokoll kitöltése', 'Lezárás előtt ellenőrizze: minden jelölt mező ki van töltve?', 'Ezután fényképezze le a jegyzőkönyvet, és töltse fel a „Dokument hinzufügen” résznél.', 'Értettem',
    ['Borítékok száma', 'Jelölje: postaláda vagy személyesen', 'Név a postaládán – vagy a címzett neve és aláírása', 'Dátum és idő', 'Helység', 'Az Ön neve és aláírása']),
  cs: Z('Dále', 'Vyplňte Zustellprotokoll', 'Před dokončením zkontrolujte: jsou vyplněna všechna označená pole?', 'Pak protokol vyfoťte a nahrajte v „Dokument hinzufügen“.', 'Rozumím',
    ['Počet obálek', 'Zaškrtněte: schránka nebo osobně', 'Jméno na schránce – nebo jméno a podpis příjemce', 'Datum a čas', 'Místo', 'Vaše jméno a podpis']),
  sk: Z('Ďalej', 'Vyplňte Zustellprotokoll', 'Pred dokončením skontrolujte: sú vyplnené všetky označené polia?', 'Potom protokol odfoťte a nahrajte v „Dokument hinzufügen“.', 'Rozumiem',
    ['Počet obálok', 'Zaškrtnite: schránka alebo osobne', 'Meno na schránke – alebo meno a podpis príjemcu', 'Dátum a čas', 'Miesto', 'Vaše meno a podpis']),
  hr: Z('Dalje', 'Ispunite Zustellprotokoll', 'Prije završetka provjerite: jesu li sva označena polja ispunjena?', 'Zatim fotografirajte zapisnik i učitajte ga pod „Dokument hinzufügen”.', 'Razumijem',
    ['Broj omotnica', 'Označite: sandučić ili osobno', 'Ime na sandučiću – ili ime i potpis primatelja', 'Datum i vrijeme', 'Mjesto', 'Vaše ime i potpis']),
  sr: Z('Dalje', 'Popunite Zustellprotokoll', 'Pre završetka proverite: da li su sva označena polja popunjena?', 'Zatim fotografišite zapisnik i otpremite ga u „Dokument hinzufügen”.', 'Razumem',
    ['Broj koverti', 'Označite: sanduče ili lično', 'Ime na sandučetu – ili ime i potpis primaoca', 'Datum i vreme', 'Mesto', 'Vaše ime i potpis']),
  sl: Z('Naprej', 'Izpolnite Zustellprotokoll', 'Pred zaključkom preverite: ali so izpolnjena vsa označena polja?', 'Nato zapisnik fotografirajte in ga naložite pod „Dokument hinzufügen”.', 'Razumem',
    ['Število ovojnic', 'Označite: nabiralnik ali osebno', 'Ime na nabiralniku – ali ime in podpis prejemnika', 'Datum in ura', 'Kraj', 'Vaše ime in podpis']),
  sq: Z('Vazhdo', 'Plotësoni Zustellprotokoll', 'Para përfundimit kontrolloni: a janë plotësuar të gjitha fushat e shënuara?', 'Pastaj fotografoni protokollin dhe ngarkojeni te „Dokument hinzufügen”.', 'E kuptova',
    ['Numri i zarfeve', 'Shënoni: kutia postare ose personalisht', 'Emri në kutinë postare – ose emri dhe nënshkrimi i marrësit', 'Data dhe ora', 'Vendi', 'Emri dhe nënshkrimi juaj']),
  uk: Z('Далі', 'Заповніть Zustellprotokoll', 'Перед завершенням перевірте: чи заповнені всі позначені поля?', 'Потім сфотографуйте протокол і завантажте його в „Dokument hinzufügen“.', 'Зрозуміло',
    ['Кількість конвертів', 'Позначте: скринька чи особисто', 'Ім’я на скриньці – або ім’я та підпис одержувача', 'Дата й час', 'Населений пункт', 'Ваше ім’я та підпис']),
  ru: Z('Далее', 'Заполните Zustellprotokoll', 'Перед завершением проверьте: заполнены ли все отмеченные поля?', 'Затем сфотографируйте протокол и загрузите его в „Dokument hinzufügen“.', 'Понятно',
    ['Количество конвертов', 'Отметьте: ящик или лично', 'Имя на почтовом ящике – или имя и подпись получателя', 'Дата и время', 'Населённый пункт', 'Ваше имя и подпись']),
  tr: Z('İleri', 'Zustellprotokoll’u doldurun', 'Bitirmeden önce kontrol edin: işaretli tüm alanlar dolduruldu mu?', 'Ardından protokolün fotoğrafını çekip „Dokument hinzufügen” bölümüne yükleyin.', 'Anladım',
    ['Zarf sayısı', 'İşaretleyin: posta kutusu veya elden', 'Posta kutusundaki isim – ya da alıcının adı ve imzası', 'Tarih ve saat', 'Yer', 'Adınız ve imzanız']),
  it: Z('Avanti', 'Compilare lo Zustellprotokoll', 'Prima di concludere controllate: tutti i campi evidenziati sono compilati?', 'Poi fotografate il protocollo e caricatelo in „Dokument hinzufügen”.', 'Capito',
    ['Numero di buste', 'Barrare: cassetta postale o di persona', 'Nome sulla cassetta – oppure nome e firma del destinatario', 'Data e ora', 'Località', 'Il vostro nome e la firma']),
  es: Z('Siguiente', 'Rellene el Zustellprotokoll', 'Antes de terminar compruebe: ¿están rellenos todos los campos marcados?', 'Después fotografíe el protocolo y súbalo en „Dokument hinzufügen”.', 'Entendido',
    ['Número de sobres', 'Marque: buzón o en mano', 'Nombre del buzón – o nombre y firma del destinatario', 'Fecha y hora', 'Localidad', 'Su nombre y firma']),
  fr: Z('Suivant', 'Remplir le Zustellprotokoll', 'Avant de terminer, vérifiez : tous les champs marqués sont-ils remplis ?', 'Ensuite, photographiez le protocole et téléversez-le dans « Dokument hinzufügen ».', 'Compris',
    ['Nombre d’enveloppes', 'Cocher : boîte aux lettres ou en main propre', 'Nom sur la boîte – ou nom et signature du destinataire', 'Date et heure', 'Lieu', 'Votre nom et votre signature']),
  pt: Z('Seguinte', 'Preencha o Zustellprotokoll', 'Antes de terminar verifique: todos os campos assinalados estão preenchidos?', 'Depois fotografe o protocolo e carregue-o em „Dokument hinzufügen”.', 'Entendido',
    ['Número de envelopes', 'Assinale: caixa de correio ou em mão', 'Nome na caixa de correio – ou nome e assinatura do destinatário', 'Data e hora', 'Localidade', 'O seu nome e assinatura']),
  nl: Z('Verder', 'Zustellprotokoll invullen', 'Controleer vóór het afronden: zijn alle gemarkeerde velden ingevuld?', 'Fotografeer daarna het protocol en upload het bij „Dokument hinzufügen”.', 'Begrepen',
    ['Aantal enveloppen', 'Aankruisen: brievenbus of persoonlijk', 'Naam op de brievenbus – of naam en handtekening van de ontvanger', 'Datum en tijd', 'Plaats', 'Uw naam en handtekening']),
  el: Z('Επόμενο', 'Συμπληρώστε το Zustellprotokoll', 'Πριν ολοκληρώσετε ελέγξτε: έχουν συμπληρωθεί όλα τα σημειωμένα πεδία;', 'Μετά φωτογραφίστε το πρωτόκολλο και ανεβάστε το στο „Dokument hinzufügen”.', 'Κατάλαβα',
    ['Αριθμός φακέλων', 'Σημειώστε: γραμματοκιβώτιο ή προσωπικά', 'Όνομα στο γραμματοκιβώτιο – ή όνομα και υπογραφή παραλήπτη', 'Ημερομηνία και ώρα', 'Τόπος', 'Το όνομα και η υπογραφή σας']),
  lt: Z('Toliau', 'Užpildykite Zustellprotokoll', 'Prieš baigdami patikrinkite: ar užpildyti visi pažymėti laukai?', 'Tada nufotografuokite protokolą ir įkelkite jį skiltyje „Dokument hinzufügen“.', 'Supratau',
    ['Vokų skaičius', 'Pažymėkite: pašto dėžutė ar asmeniškai', 'Pavardė ant dėžutės – arba gavėjo vardas ir parašas', 'Data ir laikas', 'Vietovė', 'Jūsų vardas ir parašas']),
  lv: Z('Tālāk', 'Aizpildiet Zustellprotokoll', 'Pirms pabeigšanas pārbaudiet: vai visi atzīmētie lauki ir aizpildīti?', 'Pēc tam nofotografējiet protokolu un augšupielādējiet to sadaļā „Dokument hinzufügen”.', 'Sapratu',
    ['Aplokšņu skaits', 'Atzīmējiet: pastkastīte vai personīgi', 'Vārds uz pastkastītes – vai saņēmēja vārds un paraksts', 'Datums un laiks', 'Vieta', 'Jūsu vārds un paraksts']),
}

// Ridicarea de documente, la sosire (05.11.2026, cerut de Andrei): o singură
// fereastră clară — Zustellprotokoll, pozele cu plicul şi, dacă e comandată,
// Übergabe- und Botenbestätigung: se încarcă la „Dokument hinzufügen", abia
// apoi se poate încheia ridicarea, iar originalul rămâne la client.
// Denumirile de pe ecran („Dokument hinzufügen", „Protokoll + Bote senden")
// rămân în germană, cum apar în aplicaţie.
const R = (titlu, zp, foto, botenTitlu, boten, buton) => ({ titlu, zp, foto, botenTitlu, boten, buton })
export const RIDICARE_DOC = {
  de: R('Abholung der Dokumente', 'Zustellprotokoll: vom Absender mitnehmen – ohne Zustellprotokoll keine Zustellung. Fehlt es: oben auf „Protokoll + Bote senden“ tippen.', 'Fotos: 1–2 Fotos vom verschlossenen Umschlag – Vorderseite und Rückseite.', 'Übergabe- und Botenbestätigung – vom Kunden gebucht',
    ['Gemeinsam mit dem Absender ausfüllen – beide unterschreiben.', 'Unter „Dokument hinzufügen“ hochladen – erst danach lässt sich die Abholung abschließen.', 'Das Original bleibt beim Kunden.'], 'Verstanden'),
  en: R('Document pickup', 'Zustellprotokoll: take it from the sender – no delivery without it. Missing: tap “Protokoll + Bote senden” at the top.', 'Photos: 1–2 photos of the sealed envelope – front and back.', 'Übergabe- und Botenbestätigung – booked by the client',
    ['Fill it in together with the sender – both of you sign.', 'Upload it under “Dokument hinzufügen” – only then can the pickup be completed.', 'The original stays with the client.'], 'Understood'),
  ro: R('Ridicarea documentelor', 'Zustellprotokoll: îl luați de la expeditor – fără el nu se poate livra. Dacă lipsește: apăsați sus pe „Protokoll + Bote senden”.', 'Poze: 1–2 poze cu plicul închis – fața și spatele.', 'Übergabe- und Botenbestätigung – comandată de client',
    ['Se completează împreună cu expeditorul – semnați amândoi.', 'Se încarcă la „Dokument hinzufügen” – abia apoi se poate încheia ridicarea.', 'Originalul rămâne la client.'], 'Am înțeles'),
  pl: R('Odbiór dokumentów', 'Zustellprotokoll: zabierz od nadawcy – bez niego nie ma doręczenia. Brak: stuknij u góry „Protokoll + Bote senden”.', 'Zdjęcia: 1–2 zdjęcia zamkniętej koperty – przód i tył.', 'Übergabe- und Botenbestätigung – zamówiona przez klienta',
    ['Wypełnij razem z nadawcą – podpisujecie oboje.', 'Prześlij w „Dokument hinzufügen” – dopiero wtedy można zakończyć odbiór.', 'Oryginał zostaje u klienta.'], 'Rozumiem'),
  bg: R('Вземане на документи', 'Zustellprotokoll: вземете го от подателя – без него няма доставка. Липсва: натиснете горе „Protokoll + Bote senden“.', 'Снимки: 1–2 снимки на затворения плик – отпред и отзад.', 'Übergabe- und Botenbestätigung – поръчана от клиента',
    ['Попълнете заедно с подателя – двамата подписвате.', 'Качете я в „Dokument hinzufügen“ – едва след това вземането може да приключи.', 'Оригиналът остава при клиента.'], 'Разбрах'),
  hu: R('Dokumentumok átvétele', 'Zustellprotokoll: vegye át a feladótól – nélküle nincs kézbesítés. Ha hiányzik: koppintson fent a „Protokoll + Bote senden” gombra.', 'Fotók: 1–2 fotó a lezárt borítékról – elöl és hátul.', 'Übergabe- und Botenbestätigung – az ügyfél rendelte',
    ['Töltse ki a feladóval együtt – mindketten aláírják.', 'Töltse fel a „Dokument hinzufügen” résznél – csak ezután zárható le az átvétel.', 'Az eredeti az ügyfélnél marad.'], 'Értettem'),
  cs: R('Vyzvednutí dokumentů', 'Zustellprotokoll: převezměte od odesílatele – bez něj není doručení. Chybí: nahoře klepněte na „Protokoll + Bote senden“.', 'Fotky: 1–2 fotky zalepené obálky – přední a zadní strana.', 'Übergabe- und Botenbestätigung – objednaná zákazníkem',
    ['Vyplňte společně s odesílatelem – oba podepíšete.', 'Nahrajte v „Dokument hinzufügen“ – teprve pak lze vyzvednutí dokončit.', 'Originál zůstává u zákazníka.'], 'Rozumím'),
  sk: R('Vyzdvihnutie dokumentov', 'Zustellprotokoll: prevezmite od odosielateľa – bez neho nie je doručenie. Chýba: hore ťuknite na „Protokoll + Bote senden“.', 'Fotky: 1–2 fotky zalepenej obálky – predná a zadná strana.', 'Übergabe- und Botenbestätigung – objednaná zákazníkom',
    ['Vyplňte spolu s odosielateľom – obaja podpíšete.', 'Nahrajte v „Dokument hinzufügen“ – až potom sa dá vyzdvihnutie dokončiť.', 'Originál zostáva u zákazníka.'], 'Rozumiem'),
  hr: R('Preuzimanje dokumenata', 'Zustellprotokoll: uzmite ga od pošiljatelja – bez njega nema dostave. Nedostaje: gore dodirnite „Protokoll + Bote senden”.', 'Fotografije: 1–2 fotografije zatvorene omotnice – prednja i stražnja strana.', 'Übergabe- und Botenbestätigung – naručio kupac',
    ['Ispunite zajedno s pošiljateljem – oboje potpisujete.', 'Učitajte pod „Dokument hinzufügen” – tek tada se preuzimanje može završiti.', 'Original ostaje kod kupca.'], 'Razumijem'),
  sr: R('Preuzimanje dokumenata', 'Zustellprotokoll: uzmite ga od pošiljaoca – bez njega nema dostave. Nedostaje: gore dodirnite „Protokoll + Bote senden”.', 'Fotografije: 1–2 fotografije zatvorene koverte – prednja i zadnja strana.', 'Übergabe- und Botenbestätigung – naručio kupac',
    ['Popunite zajedno sa pošiljaocem – oboje potpisujete.', 'Otpremite u „Dokument hinzufügen” – tek tada se preuzimanje može završiti.', 'Original ostaje kod kupca.'], 'Razumem'),
  sl: R('Prevzem dokumentov', 'Zustellprotokoll: vzemite ga od pošiljatelja – brez njega ni dostave. Manjka: zgoraj tapnite „Protokoll + Bote senden”.', 'Fotografije: 1–2 fotografiji zaprte ovojnice – spredaj in zadaj.', 'Übergabe- und Botenbestätigung – naročila stranka',
    ['Izpolnite skupaj s pošiljateljem – oba podpišeta.', 'Naložite pod „Dokument hinzufügen” – šele nato je mogoče prevzem zaključiti.', 'Izvirnik ostane pri stranki.'], 'Razumem'),
  sq: R('Marrja e dokumenteve', 'Zustellprotokoll: merreni nga dërguesi – pa të nuk ka dorëzim. Mungon: prekni lart „Protokoll + Bote senden”.', 'Foto: 1–2 foto të zarfit të mbyllur – përpara dhe prapa.', 'Übergabe- und Botenbestätigung – e porositur nga klienti',
    ['Plotësojeni bashkë me dërguesin – nënshkruani të dy.', 'Ngarkojeni te „Dokument hinzufügen” – vetëm atëherë marrja mund të përfundojë.', 'Origjinali mbetet te klienti.'], 'E kuptova'),
  uk: R('Отримання документів', 'Zustellprotokoll: візьміть у відправника – без нього доставки немає. Немає: натисніть угорі „Protokoll + Bote senden“.', 'Фото: 1–2 фото запечатаного конверта – спереду й ззаду.', 'Übergabe- und Botenbestätigung – замовлена клієнтом',
    ['Заповніть разом із відправником – обоє підписуєте.', 'Завантажте в „Dokument hinzufügen“ – лише після цього можна завершити отримання.', 'Оригінал залишається в клієнта.'], 'Зрозуміло'),
  ru: R('Получение документов', 'Zustellprotokoll: заберите у отправителя – без него доставки нет. Нет: нажмите вверху „Protokoll + Bote senden“.', 'Фото: 1–2 фото запечатанного конверта – спереди и сзади.', 'Übergabe- und Botenbestätigung – заказана клиентом',
    ['Заполните вместе с отправителем – оба подписываете.', 'Загрузите в „Dokument hinzufügen“ – только после этого можно завершить получение.', 'Оригинал остаётся у клиента.'], 'Понятно'),
  tr: R('Belgelerin alınması', 'Zustellprotokoll: göndericiden alın – o olmadan teslimat yok. Yoksa: üstte „Protokoll + Bote senden”e dokunun.', 'Fotoğraflar: kapalı zarfın 1–2 fotoğrafı – ön ve arka yüz.', 'Übergabe- und Botenbestätigung – müşteri tarafından sipariş edildi',
    ['Gönderici ile birlikte doldurun – ikiniz de imzalayın.', '„Dokument hinzufügen” bölümüne yükleyin – ancak bundan sonra alım tamamlanabilir.', 'Orijinal müşteride kalır.'], 'Anladım'),
  it: R('Ritiro dei documenti', 'Zustellprotokoll: ritiratelo dal mittente – senza non c’è consegna. Manca: toccate in alto „Protokoll + Bote senden”.', 'Foto: 1–2 foto della busta chiusa – fronte e retro.', 'Übergabe- und Botenbestätigung – prenotata dal cliente',
    ['Compilatela insieme al mittente – firmate entrambi.', 'Caricatela in „Dokument hinzufügen” – solo dopo si può chiudere il ritiro.', 'L’originale resta al cliente.'], 'Capito'),
  es: R('Recogida de documentos', 'Zustellprotokoll: recójalo del remitente – sin él no hay entrega. Si falta: toque arriba „Protokoll + Bote senden”.', 'Fotos: 1–2 fotos del sobre cerrado – anverso y reverso.', 'Übergabe- und Botenbestätigung – contratada por el cliente',
    ['Rellénela junto con el remitente – firman ambos.', 'Súbala en „Dokument hinzufügen” – solo entonces se puede cerrar la recogida.', 'El original se queda con el cliente.'], 'Entendido'),
  fr: R('Enlèvement des documents', 'Zustellprotokoll : le prendre chez l’expéditeur – sans lui, pas de livraison. S’il manque : touchez « Protokoll + Bote senden » en haut.', 'Photos : 1 à 2 photos de l’enveloppe fermée – recto et verso.', 'Übergabe- und Botenbestätigung – commandée par le client',
    ['La remplir avec l’expéditeur – vous signez tous les deux.', 'La téléverser dans « Dokument hinzufügen » – ce n’est qu’ensuite que l’enlèvement peut être clôturé.', 'L’original reste chez le client.'], 'Compris'),
  pt: R('Recolha dos documentos', 'Zustellprotokoll: levá-lo do remetente – sem ele não há entrega. Se faltar: toque em cima em „Protokoll + Bote senden”.', 'Fotos: 1–2 fotos do envelope fechado – frente e verso.', 'Übergabe- und Botenbestätigung – contratada pelo cliente',
    ['Preencha-a com o remetente – assinam os dois.', 'Carregue-a em „Dokument hinzufügen” – só depois a recolha pode ser concluída.', 'O original fica com o cliente.'], 'Entendido'),
  nl: R('Documenten ophalen', 'Zustellprotokoll: van de afzender meenemen – zonder geen bezorging. Ontbreekt het: tik bovenaan op „Protokoll + Bote senden”.', 'Foto’s: 1–2 foto’s van de gesloten envelop – voor- en achterkant.', 'Übergabe- und Botenbestätigung – door de klant geboekt',
    ['Samen met de afzender invullen – jullie tekenen allebei.', 'Uploaden bij „Dokument hinzufügen” – pas daarna kan het ophalen worden afgerond.', 'Het origineel blijft bij de klant.'], 'Begrepen'),
  el: R('Παραλαβή εγγράφων', 'Zustellprotokoll: πάρτε το από τον αποστολέα – χωρίς αυτό δεν γίνεται παράδοση. Λείπει: πατήστε πάνω „Protokoll + Bote senden”.', 'Φωτογραφίες: 1–2 φωτογραφίες του κλειστού φακέλου – μπρος και πίσω.', 'Übergabe- und Botenbestätigung – την παρήγγειλε ο πελάτης',
    ['Συμπληρώστε τη μαζί με τον αποστολέα – υπογράφετε και οι δύο.', 'Ανεβάστε τη στο „Dokument hinzufügen” – μόνο τότε ολοκληρώνεται η παραλαβή.', 'Το πρωτότυπο μένει στον πελάτη.'], 'Κατάλαβα'),
  lt: R('Dokumentų paėmimas', 'Zustellprotokoll: paimkite iš siuntėjo – be jo pristatymo nėra. Trūksta: viršuje palieskite „Protokoll + Bote senden“.', 'Nuotraukos: 1–2 užklijuoto voko nuotraukos – priekis ir galas.', 'Übergabe- und Botenbestätigung – užsakyta kliento',
    ['Užpildykite kartu su siuntėju – pasirašote abu.', 'Įkelkite skiltyje „Dokument hinzufügen“ – tik tada galima užbaigti paėmimą.', 'Originalas lieka klientui.'], 'Supratau'),
  lv: R('Dokumentu saņemšana', 'Zustellprotokoll: paņemiet no sūtītāja – bez tā piegādes nav. Ja trūkst: augšā pieskarieties „Protokoll + Bote senden”.', 'Foto: 1–2 foto ar aizlīmēto aploksni – priekšpuse un aizmugure.', 'Übergabe- und Botenbestätigung – klienta pasūtīta',
    ['Aizpildiet kopā ar sūtītāju – parakstāties abi.', 'Augšupielādējiet sadaļā „Dokument hinzufügen” – tikai tad saņemšanu var pabeigt.', 'Oriģināls paliek pie klienta.'], 'Sapratu'),
}

// Fereastra „Înainte de plecare" la documente (05.11.2026, cerut de Andrei):
// doar două puncte. Fraza „la mai mulţi destinatari, câte o foaie pentru
// fiecare" apare NUMAI când comanda are mai multe livrări.
// [punctul 1, punctul 2, adaosul pentru mai mulţi destinatari]
export const PLECARE_DOC = {
  de: ['Dokumentenzustellung: Ohne Zustellprotokoll ist keine Zustellung möglich.', 'Das Zustellprotokoll bekommen Sie bei der Abholung vom Auftraggeber – ausgedruckt. Fehlt es: die Abholung nicht abschließen, sondern beim Auftraggeber anfordern.', 'Mehrere Empfänger: ein Blatt pro Empfänger.'],
  en: ['Document delivery: no delivery is possible without the Zustellprotokoll.', 'The client hands you the Zustellprotokoll at pickup – printed. If it is missing: do not complete the pickup, ask the client for it.', 'Several recipients: one sheet per recipient.'],
  ro: ['Livrare de documente: fără Zustellprotokoll livrarea nu este posibilă.', 'Zustellprotokoll vi-l dă clientul la ridicare – tipărit. Dacă lipsește: nu finalizați ridicarea, cereți-l clientului.', 'Mai mulți destinatari: câte o foaie pentru fiecare.'],
  pl: ['Doręczenie dokumentów: bez Zustellprotokoll doręczenie nie jest możliwe.', 'Zustellprotokoll otrzymasz od zleceniodawcy przy odbiorze – wydrukowany. Jeśli go brak: nie kończ odbioru, poproś o niego zleceniodawcę.', 'Kilku odbiorców: jedna kartka na odbiorcę.'],
  bg: ['Доставка на документи: без Zustellprotokoll доставката не е възможна.', 'Zustellprotokoll ви го дава възложителят при вземането – отпечатан. Ако липсва: не приключвайте вземането, поискайте го от възложителя.', 'Няколко получатели: по един лист за всеки.'],
  hu: ['Dokumentumkézbesítés: Zustellprotokoll nélkül nincs kézbesítés.', 'A Zustellprotokollt átvételkor a megrendelő adja át – kinyomtatva. Ha hiányzik: ne zárja le az átvételt, kérje el a megrendelőtől.', 'Több címzett: címzettenként egy lap.'],
  cs: ['Doručení dokumentů: bez Zustellprotokoll není doručení možné.', 'Zustellprotokoll vám předá zadavatel při vyzvednutí – vytištěný. Chybí-li: vyzvednutí nedokončujte, vyžádejte si ho od zadavatele.', 'Více příjemců: jeden list na příjemce.'],
  sk: ['Doručenie dokumentov: bez Zustellprotokoll nie je doručenie možné.', 'Zustellprotokoll vám odovzdá objednávateľ pri vyzdvihnutí – vytlačený. Ak chýba: vyzdvihnutie nedokončujte, vyžiadajte si ho od objednávateľa.', 'Viac príjemcov: jeden list na príjemcu.'],
  hr: ['Dostava dokumenata: bez Zustellprotokoll dostava nije moguća.', 'Zustellprotokoll dobivate od naručitelja pri preuzimanju – ispisan. Ako nedostaje: ne završavajte preuzimanje, zatražite ga od naručitelja.', 'Više primatelja: jedan list po primatelju.'],
  sr: ['Dostava dokumenata: bez Zustellprotokoll dostava nije moguća.', 'Zustellprotokoll dobijate od naručioca pri preuzimanju – odštampan. Ako nedostaje: ne završavajte preuzimanje, zatražite ga od naručioca.', 'Više primalaca: jedan list po primaocu.'],
  sl: ['Dostava dokumentov: brez Zustellprotokoll dostava ni mogoča.', 'Zustellprotokoll prejmete od naročnika ob prevzemu – natisnjen. Če manjka: prevzema ne zaključite, zahtevajte ga od naročnika.', 'Več prejemnikov: en list na prejemnika.'],
  sq: ['Dorëzim dokumentesh: pa Zustellprotokoll dorëzimi nuk është i mundur.', 'Zustellprotokoll jua jep porositësi në marrje – të printuar. Nëse mungon: mos e përfundoni marrjen, kërkojeni nga porositësi.', 'Disa marrës: një fletë për çdo marrës.'],
  uk: ['Доставка документів: без Zustellprotokoll доставка неможлива.', 'Zustellprotokoll вам дає замовник під час отримання – роздрукований. Якщо його немає: не завершуйте отримання, попросіть його в замовника.', 'Кілька одержувачів: по аркушу на кожного.'],
  ru: ['Доставка документов: без Zustellprotokoll доставка невозможна.', 'Zustellprotokoll вам даёт заказчик при получении – распечатанным. Если его нет: не завершайте получение, попросите его у заказчика.', 'Несколько получателей: по листу на каждого.'],
  tr: ['Belge teslimatı: Zustellprotokoll olmadan teslimat mümkün değildir.', 'Zustellprotokoll’u alımda müşteri size verir – basılı. Yoksa: alımı tamamlamayın, müşteriden isteyin.', 'Birden fazla alıcı: her alıcı için bir sayfa.'],
  it: ['Consegna di documenti: senza Zustellprotokoll la consegna non è possibile.', 'Lo Zustellprotokoll ve lo consegna il committente al ritiro – stampato. Se manca: non chiudete il ritiro, chiedetelo al committente.', 'Più destinatari: un foglio per destinatario.'],
  es: ['Entrega de documentos: sin Zustellprotokoll no es posible la entrega.', 'El cliente le entrega el Zustellprotokoll en la recogida – impreso. Si falta: no cierre la recogida, pídaselo al cliente.', 'Varios destinatarios: una hoja por destinatario.'],
  fr: ['Livraison de documents : sans Zustellprotokoll, aucune livraison n’est possible.', 'Le donneur d’ordre vous remet le Zustellprotokoll à l’enlèvement – imprimé. S’il manque : ne clôturez pas l’enlèvement, demandez-le au donneur d’ordre.', 'Plusieurs destinataires : une feuille par destinataire.'],
  pt: ['Entrega de documentos: sem Zustellprotokoll a entrega não é possível.', 'O cliente entrega-lhe o Zustellprotokoll na recolha – impresso. Se faltar: não conclua a recolha, peça-o ao cliente.', 'Vários destinatários: uma folha por destinatário.'],
  nl: ['Documentbezorging: zonder Zustellprotokoll is bezorging niet mogelijk.', 'Het Zustellprotokoll krijgt u bij het ophalen van de opdrachtgever – geprint. Ontbreekt het: rond het ophalen niet af, vraag het bij de opdrachtgever.', 'Meerdere ontvangers: één blad per ontvanger.'],
  el: ['Παράδοση εγγράφων: χωρίς Zustellprotokoll η παράδοση δεν είναι δυνατή.', 'Το Zustellprotokoll σας το δίνει ο πελάτης στην παραλαβή – τυπωμένο. Αν λείπει: μην ολοκληρώσετε την παραλαβή, ζητήστε το από τον πελάτη.', 'Πολλοί παραλήπτες: ένα φύλλο ανά παραλήπτη.'],
  lt: ['Dokumentų pristatymas: be Zustellprotokoll pristatyti negalima.', 'Zustellprotokoll paėmimo metu jums duoda užsakovas – atspausdintą. Jei jo nėra: paėmimo neužbaikite, paprašykite jo užsakovo.', 'Keli gavėjai: po vieną lapą kiekvienam.'],
  lv: ['Dokumentu piegāde: bez Zustellprotokoll piegāde nav iespējama.', 'Zustellprotokoll saņemšanas laikā jums iedod pasūtītājs – izdrukātu. Ja tā nav: nepabeidziet saņemšanu, palūdziet to pasūtītājam.', 'Vairāki saņēmēji: viena lapa katram.'],
}
