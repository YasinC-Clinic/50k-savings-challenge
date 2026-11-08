/**
 * Swedish texts (the default language). The `Messages` type is derived from this object, so the English file
 * cannot miss or add a key without a compile error. Parameters are already formatted (amounts, dates) by the caller.
 */
export const sv = {
  language: {
    heading: 'Språk / Language',
    svenska: 'Svenska 🇸🇪',
    english: 'English 🇬🇧',
  },

  app: {
    documentTitle: '50K Sparutmaning',
    brand: 'spar',
    loading: 'Förbereder ditt sparande…',
    privateBadge: 'Privat · på den här enheten',
    dismiss: 'Stäng meddelandet',
    navLabel: 'Huvudmeny',
    tabs: { home: 'Idag', calendar: 'Kalender', challenges: 'Utmaningar', settings: 'Inställningar' },
  },

  common: { cancel: 'Avbryt', save: 'Spara' },

  units: {
    days: (count: number) => (count === 1 ? '1 dag' : `${count} dagar`),
    challenges: (count: number): string => (count === 1 ? 'utmaning' : 'utmaningar'),
  },

  status: {
    day: { undrawn: 'Ej dragen', drawn: 'Dragen', confirmed: 'Bekräftad', missed: 'Missad' },
    challenge: { upcoming: 'Kommande', active: 'Pågår', finished: 'Avslutad' },
    origin: {
      created: null as string | null,
      'legacy-v1-migration': 'Från tidigare version' as string | null,
      'legacy-v1-backup': 'Importerad (äldre säkerhetskopia)' as string | null,
      'backup-import': 'Importerad säkerhetskopia' as string | null,
      'backup-restore': 'Återställd från säkerhetskopia' as string | null,
    },
    /** Name shown for a challenge without a name. */
    unnamed: (target: string) => `Utmaning ${target}`,
  },

  home: {
    sectionLabel: 'Aktiv utmaning',
    eyebrow: (status: string) => `Aktiv utmaning · ${status}`,
    switchLink: 'Byt eller skapa utmaning',
    progressLabel: 'Sparande hittills',
    progressHeading: 'Ditt sparande',
    progressBar: 'Andel av målet som är sparat',
    savedSoFar: (amount: string) => `${amount} sparat`,
    goal: (amount: string) => `Mål ${amount}`,
    balanceLabel: 'Sammanfattning',
    confirmedSaved: 'Bekräftat sparat',
    remaining: (amount: string) => `${amount} kvar att spara`,
    pending: (amount: string) => `Draget men ännu inte bekräftat: ${amount} (räknas inte som sparat)`,
    confirmedDays: (count: number): string => (count === 1 ? 'bekräftad dag' : 'bekräftade dagar'),
    daysLeft: (count: number): string => (count === 1 ? 'dag kvar' : 'dagar kvar'),
    missed: (count: number): string => (count === 1 ? 'missad' : 'missade'),
    daily: {
      label: 'Dagens utmaning',
      upcoming: 'KOMMANDE',
      finished: 'AVSLUTAD',
      dayOf: (day: number, total: number) => `DAG ${day} AV ${total}`,
      upcomingTitle: 'Din första dragning väntar',
      upcomingBody: (date: string) => `Utmaningen börjar ${date}. Dina belopp är förberedda men hålls dolda tills du drar dem.`,
      finishedTitle: 'Tiden har gått ut',
      finishedBody: 'Historiken finns kvar. Slutdatumet flyttas aldrig automatiskt.',
      undrawnTitle: 'Dagens belopp väntar',
      undrawnBody:
        'Dra ett slumpmässigt belopp för idag. Kommande belopp förblir dolda. Appen är inte kopplad till någon bank – du för själv över pengarna.',
      drawButton: 'Dra dagens belopp',
      drawnLabel: 'Idag – inte bekräftat än',
      drawnBody:
        'Beloppet är fast. För över det själv via din bank – appen flyttar inga pengar. Det räknas som sparat först när du har gjort överföringen och bekräftar här.',
      confirmButton: 'Jag har sparat beloppet',
      confirmedLabel: 'Sparat idag',
      confirmedCopy: 'Bekräftat och registrerat.',
      missedTitle: 'Dagen missades',
      missedBody: 'Missade dagar räknas inte som sparade. Planen för kommande dagar har räknats om om det var möjligt.',
    },
    confirmDialog: {
      title: 'Bekräfta sparandet',
      confirm: 'Ja, jag har sparat det',
      before: 'Har du själv fört över ',
      after:
        ' till ditt sparande via din bank? Appen är inte kopplad till någon bank och har inte flyttat några pengar. Först när du bekräftar räknas beloppet som sparat, och det går inte att ångra.',
    },
    dismissNotice: 'Stäng meddelandet',
  },

  calendar: {
    emptyTitle: 'Kalender',
    emptyIntro: 'Skapa en utmaning för att se din kalender.',
    heading: 'Kalender och historik',
    intro: 'Ett belopp syns först när dagen är dragen, bekräftad eller missad.',
    legendLabel: 'Förklaring',
    legend: { confirmed: 'Bekräftad', drawn: 'Dragen, ej bekräftad', missed: 'Missad' },
    monthConfirmed: (amount: string) => `${amount} bekräftat sparat`,
    weekdays: ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön'],
    dayLabel: (date: string, status: string, amount: string | null) => `${date}: ${status}${amount === null ? '' : `, ${amount}`}`,
  },

  challenges: {
    eyebrow: 'Dina utmaningar',
    title: 'Utmaningar',
    intro: 'Varje utmaning är helt separat. Om du skapar en ny behålls alla andra med allt sparande.',
    newButton: 'Ny utmaning',
    newTitle: 'Ny utmaning',
    create: 'Skapa utmaning',
    current: 'Pågående och kommande',
    history: 'Avslutade (historik)',
    active: 'Aktiv',
    makeActive: 'Gör aktiv',
    rename: 'Byt namn',
    newName: 'Nytt namn',
    meta: (range: string, days: string) => `${range} · ${days}`,
    savedOf: (target: string, confirmedDays: string) => ` sparat av ${target} · ${confirmedDays}`,
    confirmedDaysCount: (count: number) => (count === 1 ? '1 bekräftad dag' : `${count} bekräftade dagar`),
  },

  form: {
    legend: 'Hur länge vill du spara?',
    nameLabel: 'Namn (valfritt)',
    targetLabel: 'Sparmål (kr)',
    minLabel: 'Lägsta dagsbelopp (kr)',
    maxLabel: 'Högsta dagsbelopp (kr)',
    summaryLabel: 'Sammanfattning av utmaningen',
    startDate: 'Startdatum',
    endDate: 'Slutdatum',
    savingDays: 'Antal spardagar',
    target: 'Sparmål',
    dailyAmounts: 'Dagsbelopp',
    today: '(idag)',
    preview: (average: string, min: string, max: string, target: string) =>
      `Cirka ${average} per dag i snitt. Varje dag slumpas ett belopp mellan ${min} och ${max}, och summan blir exakt ${target}.`,
    note: 'Appen är inte kopplad till någon bank och flyttar aldrig pengar. Du drar ett belopp, för själv över det via din bank och bekräftar sedan i appen. Dina andra utmaningar påverkas inte, och slutdatumet flyttas aldrig automatiskt.',
    cancel: 'Avbryt',
    defaultName: (number: number) => `Utmaning ${number}`,
    duration: {
      months: (count: number) => (count === 1 ? '1 månad' : `${count} månader`),
      newYear: 'Till nyår',
    },
    errors: {
      nameTooLong: (max: number) => `Namnet kan vara högst ${max} tecken.`,
      chooseDuration: 'Välj hur länge du vill spara.',
      targetInvalid: 'Ange målet i hela kronor, till exempel 50000.',
      targetZero: 'Målet måste vara större än noll.',
      targetTooHigh: (max: string) => `Målet kan vara högst ${max}.`,
      minInvalid: 'Ange lägsta dagsbelopp i hela kronor, till exempel 50.',
      minTooLow: 'Lägsta dagsbelopp måste vara minst 1 kr.',
      maxInvalid: 'Ange högsta dagsbelopp i hela kronor, till exempel 500.',
      maxTooLow: 'Högsta dagsbelopp måste vara minst 1 kr.',
      maxAboveLimit: (limit: string) => `Högsta dagsbelopp kan vara högst ${limit}.`,
      minAboveMax: 'Lägsta dagsbelopp kan inte vara högre än högsta dagsbelopp.',
      periodTooLow: (period: string, lowest: string, minimum: string) =>
        `Målet är för lågt för ${period}. Minst ${lowest} krävs (${minimum} per dag). Höj målet, sänk lägsta dagsbelopp eller välj en kortare tid.`,
      periodTooHigh: (period: string, highest: string, maximum: string) =>
        `Målet är för högt för ${period}. Högst ${highest} går att spara (${maximum} per dag). Sänk målet, höj högsta dagsbelopp eller välj en längre tid.`,
    },
  },

  onboarding: {
    eyebrow: 'Välkommen',
    titleBefore: 'Spara ',
    titleHighlight: 'steg för steg',
    intro:
      'Välj ett mål, en period och dina dagsbelopp. Varje dag drar du ett slumpmässigt belopp, för själv över pengarna via din bank och bekräftar sedan här. Appen är inte kopplad till någon bank och flyttar aldrig pengar.',
    cardTitle: 'Skapa din första utmaning',
    submit: 'Starta utmaningen',
    importHint: 'Har du en säkerhetskopia från tidigare? Importera den under Inställningar.',
  },

  settings: {
    eyebrow: 'Den här enheten',
    title: 'Inställningar',
    languageHeading: 'Språk / Language',
    languageHelp: 'Språket ändras direkt och sparas på den här enheten. Dina utmaningar och belopp påverkas inte.',
    languageGroup: 'Språk / Language',
    backupHeading: 'Säkerhetskopia',
    backupBody:
      'Säkerhetskopian innehåller alla dina utmaningar och alla dagar. Den innehåller inga konton eller uppgifter om enheten. Exportera regelbundet – webbläsaren kan rensa lagrad data.',
    exportBackup: 'Exportera säkerhetskopia',
    importBackup: 'Importera säkerhetskopia',
    chooseFile: 'Välj säkerhetskopia',
    importNote: 'Du får alltid välja innan något importeras eller ersätts.',
    storageHeading: 'Lagring',
    whereLabel: 'Var finns datan?',
    whereValue: 'Bara på den här enheten',
    protectedLabel: 'Skyddad mot rensning',
    yes: 'Ja',
    no: 'Nej',
    unknown: 'Okänt',
    storageBody: 'Ingen inloggning, inga konton och ingen molntjänst. Appen fungerar utan internet.',
    noBank: 'Appen är inte kopplad till någon bank. Den flyttar eller drar aldrig pengar – du för själv över beloppen och bekräftar dem här.',
    installHeading: 'Installera på iPhone',
    installBody: 'Öppna sidan i Safari, tryck på Dela och välj ”Lägg till på hemskärmen”. Sedan öppnas den som en vanlig app, även offline.',
    advancedHeading: 'Avancerat',
    advancedBody:
      'Rådata är en teknisk kopia av allt som ligger lagrat, utan kontroll. Den är avsedd för felsökning och kan kräva hjälp av någon med teknisk kunskap. Inget ändras eller raderas.',
    saveRaw: 'Spara rådata',
  },

  importDialog: {
    title: 'Importera säkerhetskopia',
    valid: (count: number) => `Filen är giltig och innehåller ${count} ${count === 1 ? 'utmaning' : 'utmaningar'}:`,
    savedOf: (saved: string, target: string) => `${saved} sparat av ${target}`,
    legacyBefore: 'Det här är en säkerhetskopia från en äldre version av appen. Den läggs till som en ',
    legacyBold: 'ny, separat utmaning',
    legacyAfter: '. Inget på den här enheten ersätts.',
    howLegend: 'Hur vill du importera?',
    addTitle: 'Lägg till som nya utmaningar',
    addDescription: 'Rekommenderas. Dina nuvarande utmaningar behålls helt oförändrade.',
    replaceTitle: 'Ersätt allt på den här enheten',
    replaceDescription: (count: number) =>
      `Alla ${count} nuvarande ${count === 1 ? 'utmaning' : 'utmaningar'} tas bort och ersätts av filens innehåll.`,
    warningLabel: 'Varning:',
    warningText: ' Det här tar bort allt sparande som finns på enheten nu. Det går inte att ångra utan en säkerhetskopia.',
    exportFirst: 'Exportera nuvarande data först',
    understand: 'Jag förstår att alla nuvarande utmaningar ersätts.',
    cancel: 'Avbryt',
    importAsNew: 'Importera som ny',
    replaceAll: 'Ersätt allt',
  },

  recovery: {
    eyebrow: 'Sparad data kunde inte läsas',
    title: 'Din tidigare data är skadad',
    introBefore: 'Appen hittade sparad data från en tidigare version, men den går inte att läsa säkert. ',
    introBold: 'Inget har raderats eller ändrats.',
    step1Title: 'Steg 1. Spara en kopia (rekommenderas)',
    step1Body:
      'Rådata är en teknisk fil som kan kräva hjälp av någon med teknisk kunskap för att läsas. Spara den ändå, så finns den kvar om du behöver den senare.',
    saveRaw: 'Spara rådata',
    saved: 'Rådatan är sparad som en fil på din enhet.',
    step2Title: 'Steg 2. Fortsätt utan den skadade datan',
    step2Body:
      'Då startar appen utan den. Den skadade datan finns kvar orörd på enheten och kan sparas som rådata senare. Du kan sedan skapa en ny utmaning eller importera en säkerhetskopia.',
    continue: 'Fortsätt utan den skadade datan',
    dialogTitle: 'Fortsätta utan den skadade datan?',
    dialogConfirm: 'Ja, fortsätt',
    dialogBefore: 'Appen startar tom. Den skadade datan raderas ',
    dialogBold: 'inte',
    dialogAfter: ' – den ligger kvar på enheten men visas inte.',
    dialogNoCopy: 'Du har ännu inte sparat någon kopia av rådatan. Vi rekommenderar att du gör det först.',
  },

  storageProblem: {
    eyebrow: 'Något gick fel',
    title: 'Datan kunde inte öppnas',
    body: 'Inget har ändrats. Du kan försöka igen eller spara en teknisk kopia av allt som finns lagrat.',
    retry: 'Försök igen',
    saveRaw: 'Spara rådata',
  },

  outdated: {
    eyebrow: 'Ny version',
    title: 'Appen behöver laddas om',
    body: 'Din sparade data har uppdaterats av en nyare version av appen. Ladda om för att fortsätta. Den här sidan sparar ingenting, så inget kan skadas.',
    reload: 'Ladda om',
  },

  notices: {
    raisedCeiling: {
      title: 'Högre dagsbelopp krävs',
      body: (ceiling: string, maximum: string) =>
        `För att nå målet i tid behöver några kommande dagar bli upp till ${ceiling} – mer än ditt högsta dagsbelopp på ${maximum}. Det valda taket har inte ändrats; beloppet är det som krävs för att nå målet innan slutdatumet.`,
    },
    unreachable: {
      title: 'Målet kan inte nås i tid',
      body: (target: string, endDate: string, unplanned: string, minimum: string, maximum: string) =>
        `Med de dagar som är kvar går det inte att nå ${target} till ${endDate}. ${unplanned} saknas i planen, med dagsbelopp mellan ${minimum} och ${maximum}. Slutdatumet och dagsbeloppen ändras inte automatiskt.`,
    },
    endedShort: {
      title: 'Utmaningen är avslutad',
      body: (saved: string, target: string) => `Du sparade ${saved} av ${target}. Historiken finns kvar.`,
    },
    completed: {
      title: 'Målet är nått',
      body: (target: string) => `Du har sparat hela ${target}. Bra jobbat!`,
    },
    recoveryImpossible: {
      title: 'Målet kan inte längre nås',
      body: (target: string, endDate: string, minimum: string, maximum: string) =>
        `Missade dagar gör att ${target} inte går att nå till ${endDate} med dagsbelopp mellan ${minimum} och ${maximum}. Slutdatumet flyttas inte automatiskt.`,
    },
    recoveryHigherCeiling: {
      title: 'Planen har räknats om',
      body: (ceiling: string, maximum: string) =>
        `För att nå målet krävs nu belopp upp till ${ceiling} per dag – mer än ditt högsta dagsbelopp på ${maximum}. Det valda taket har inte ändrats.`,
    },
    recoveryOk: {
      title: 'Planen har räknats om',
      body: (minimum: string, maximum: string) =>
        `Missade dagar räknas inte som sparade. De kommande beloppen har fördelats om och ligger mellan ${minimum} och ${maximum} per dag.`,
    },
  },

  errors: {
    unchanged: 'Inget på enheten har ändrats.',
    backup: {
      notJson: 'Filen går inte att läsa som en säkerhetskopia.',
      wrongFormat: 'Filen är ingen säkerhetskopia från den här appen.',
      version: 'Filen kommer från en okänd eller nyare version av appen.',
      tooLarge: 'Filen är för stor för att vara en säkerhetskopia.',
      tooMany: 'Filen innehåller fler utmaningar än vad som stöds.',
      duplicate: 'Filen innehåller samma utmaning flera gånger.',
      totals: 'Beloppen i filen stämmer inte med utmaningens mål.',
      config: 'Utmaningens inställningar i filen är ogiltiga.',
      confirmReplace: 'Du måste bekräfta att allt ska ersättas.',
      legacyReplace: 'En äldre säkerhetskopia kan bara läggas till som ny utmaning.',
      unknown: 'Innehållet i filen är ogiltigt.',
    },
    storage: {
      legacyDamaged: 'Sparad data från den tidigare versionen är skadad.',
      newerVersion: 'Datan på enheten kommer från en nyare version av appen. Ladda om appen.',
      integrity: 'Sparad data kunde inte verifieras. Inget har ändrats.',
      database: 'Det gick inte att spara på enheten. Inget har ändrats – försök igen.',
    },
    domain: {
      alreadyDrawn: 'Dagens belopp är redan draget.',
      alreadyConfirmed: 'Det här beloppet är redan bekräftat.',
      drawFirst: 'Dra dagens belopp först.',
      missedDay: 'Den här dagen har missats och kan inte dras.',
      outsideChallenge: 'Det går bara att dra och bekräfta dagens belopp.',
      generic: 'Något gick fel. Försök igen.',
    },
  },

  feedback: {
    drawn: 'Dagens belopp är draget. Det räknas som sparat först när du bekräftar.',
    confirmed: 'Sparandet är bekräftat. Bra jobbat!',
    created: 'Utmaningen är skapad och aktiv.',
    restored: 'Säkerhetskopian är återställd.',
    importedOne: 'Utmaningen är importerad som en ny utmaning.',
    importedMany: (count: number) => `${count} utmaningar är importerade som nya.`,
    dateChanged: 'Datumet har ändrats. Appen har uppdaterats – försök igen.',
  },

  files: {
    backup: (date: string) => `50k-sparande-sakerhetskopia-${date}.json`,
    raw: (date: string) => `50k-sparande-radata-${date}.json`,
  },
}

export type Messages = typeof sv
