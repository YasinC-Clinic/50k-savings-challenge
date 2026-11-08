import type { Messages } from './messages.sv'

/** English texts. Typed as `Messages`, so a missing or extra key is a compile error. */
export const en: Messages = {
  language: {
    heading: 'Språk / Language',
    svenska: 'Svenska 🇸🇪',
    english: 'English 🇬🇧',
  },

  app: {
    documentTitle: '50K Savings Challenge',
    brand: 'save',
    loading: 'Preparing your savings…',
    privateBadge: 'Private · on this device',
    dismiss: 'Dismiss message',
    navLabel: 'Main menu',
    tabs: { home: 'Today', calendar: 'Calendar', challenges: 'Challenges', settings: 'Settings' },
  },

  common: { cancel: 'Cancel', save: 'Save' },

  units: {
    days: (count: number) => (count === 1 ? '1 day' : `${count} days`),
    challenges: (count: number) => (count === 1 ? 'challenge' : 'challenges'),
  },

  status: {
    day: { undrawn: 'Not drawn', drawn: 'Drawn', confirmed: 'Confirmed', missed: 'Missed' },
    challenge: { upcoming: 'Upcoming', active: 'In progress', finished: 'Finished' },
    origin: {
      created: null,
      'legacy-v1-migration': 'From the previous version',
      'legacy-v1-backup': 'Imported (older backup)',
      'backup-import': 'Imported backup',
      'backup-restore': 'Restored from backup',
    },
    unnamed: (target: string) => `Challenge ${target}`,
  },

  home: {
    sectionLabel: 'Active challenge',
    eyebrow: (status: string) => `Active challenge · ${status}`,
    switchLink: 'Switch or create a challenge',
    progressLabel: 'Savings so far',
    progressHeading: 'Your savings',
    progressBar: 'Share of the goal that is saved',
    savedSoFar: (amount: string) => `${amount} saved`,
    goal: (amount: string) => `Goal ${amount}`,
    balanceLabel: 'Summary',
    confirmedSaved: 'Confirmed savings',
    remaining: (amount: string) => `${amount} left to save`,
    pending: (amount: string) => `Drawn but not yet confirmed: ${amount} (does not count as saved)`,
    confirmedDays: (count: number) => (count === 1 ? 'confirmed day' : 'confirmed days'),
    daysLeft: (count: number) => (count === 1 ? 'day left' : 'days left'),
    missed: (): string => 'missed',
    daily: {
      label: "Today's challenge",
      upcoming: 'UPCOMING',
      finished: 'FINISHED',
      dayOf: (day: number, total: number) => `DAY ${day} OF ${total}`,
      upcomingTitle: 'Your first draw is waiting',
      upcomingBody: (date: string) => `The challenge starts on ${date}. Your amounts are prepared but stay hidden until you draw them.`,
      finishedTitle: 'Time is up',
      finishedBody: 'Your history is kept. The end date is never extended automatically.',
      undrawnTitle: "Today's amount is waiting",
      undrawnBody:
        'Draw a random amount for today. Upcoming amounts stay hidden. The app is not connected to any bank – you transfer the money yourself.',
      drawButton: "Draw today's amount",
      drawnLabel: 'Today – not confirmed yet',
      drawnBody:
        'The amount is fixed. Transfer it yourself through your bank – the app moves no money. It only counts as saved once you have made the transfer and confirm here.',
      confirmButton: 'I have saved the amount',
      confirmedLabel: 'Saved today',
      confirmedCopy: 'Confirmed and recorded.',
      missedTitle: 'The day was missed',
      missedBody: 'Missed days do not count as saved. The plan for the coming days has been recalculated where possible.',
    },
    confirmDialog: {
      title: 'Confirm your saving',
      confirm: 'Yes, I have saved it',
      before: 'Have you transferred ',
      after:
        ' to your savings yourself through your bank? The app is not connected to any bank and has not moved any money. The amount only counts as saved once you confirm, and this cannot be undone.',
    },
    dismissNotice: 'Dismiss message',
  },

  calendar: {
    emptyTitle: 'Calendar',
    emptyIntro: 'Create a challenge to see your calendar.',
    heading: 'Calendar and history',
    intro: 'An amount is only shown once the day has been drawn, confirmed or missed.',
    legendLabel: 'Legend',
    legend: { confirmed: 'Confirmed', drawn: 'Drawn, not confirmed', missed: 'Missed' },
    monthConfirmed: (amount: string) => `${amount} confirmed saved`,
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    dayLabel: (date: string, status: string, amount: string | null) => `${date}: ${status}${amount === null ? '' : `, ${amount}`}`,
  },

  challenges: {
    eyebrow: 'Your challenges',
    title: 'Challenges',
    intro: 'Every challenge is completely separate. Creating a new one keeps all the others and all their savings.',
    newButton: 'New challenge',
    newTitle: 'New challenge',
    create: 'Create challenge',
    current: 'In progress and upcoming',
    history: 'Finished (history)',
    active: 'Active',
    makeActive: 'Make active',
    rename: 'Rename',
    newName: 'New name',
    meta: (range: string, days: string) => `${range} · ${days}`,
    savedOf: (target: string, confirmedDays: string) => ` saved of ${target} · ${confirmedDays}`,
    confirmedDaysCount: (count: number) => (count === 1 ? '1 confirmed day' : `${count} confirmed days`),
  },

  form: {
    legend: 'How long do you want to save?',
    nameLabel: 'Name (optional)',
    targetLabel: 'Savings goal (SEK)',
    minLabel: 'Lowest daily amount (SEK)',
    maxLabel: 'Highest daily amount (SEK)',
    summaryLabel: 'Challenge summary',
    startDate: 'Start date',
    endDate: 'End date',
    savingDays: 'Number of saving days',
    target: 'Savings goal',
    dailyAmounts: 'Daily amount',
    today: '(today)',
    preview: (average: string, min: string, max: string, target: string) =>
      `About ${average} per day on average. Each day gets a random amount between ${min} and ${max}, and the total is exactly ${target}.`,
    note: 'The app is not connected to any bank and never moves money. You draw an amount, transfer it yourself through your bank and then confirm in the app. Your other challenges are not affected, and the end date is never extended automatically.',
    cancel: 'Cancel',
    defaultName: (number: number) => `Challenge ${number}`,
    duration: {
      months: (count: number) => (count === 1 ? '1 month' : `${count} months`),
      newYear: 'Until New Year',
    },
    errors: {
      nameTooLong: (max: number) => `The name can be at most ${max} characters.`,
      chooseDuration: 'Choose how long you want to save.',
      targetInvalid: 'Enter the goal in whole kronor, for example 50000.',
      targetZero: 'The goal must be greater than zero.',
      targetTooHigh: (max: string) => `The goal can be at most ${max}.`,
      minInvalid: 'Enter the lowest daily amount in whole kronor, for example 50.',
      minTooLow: 'The lowest daily amount must be at least SEK 1.',
      maxInvalid: 'Enter the highest daily amount in whole kronor, for example 500.',
      maxTooLow: 'The highest daily amount must be at least SEK 1.',
      maxAboveLimit: (limit: string) => `The highest daily amount can be at most ${limit}.`,
      minAboveMax: 'The lowest daily amount cannot be higher than the highest daily amount.',
      periodTooLow: (period: string, lowest: string, minimum: string) =>
        `The goal is too low for ${period}. At least ${lowest} is needed (${minimum} per day). Raise the goal, lower the lowest daily amount or choose a shorter period.`,
      periodTooHigh: (period: string, highest: string, maximum: string) =>
        `The goal is too high for ${period}. At most ${highest} can be saved (${maximum} per day). Lower the goal, raise the highest daily amount or choose a longer period.`,
    },
  },

  onboarding: {
    eyebrow: 'Welcome',
    titleBefore: 'Save ',
    titleHighlight: 'step by step',
    intro:
      'Choose a goal, a period and your daily amounts. Each day you draw a random amount, transfer the money yourself through your bank and then confirm here. The app is not connected to any bank and never moves money.',
    cardTitle: 'Create your first challenge',
    submit: 'Start the challenge',
    importHint: 'Do you have a backup from before? Import it under Settings.',
  },

  settings: {
    eyebrow: 'This device',
    title: 'Settings',
    languageHeading: 'Språk / Language',
    languageHelp: 'The language changes immediately and is saved on this device. Your challenges and amounts are not affected.',
    languageGroup: 'Språk / Language',
    backupHeading: 'Backup',
    backupBody:
      'A backup contains all your challenges and all their days. It contains no accounts or device information. Export regularly – the browser can clear stored data.',
    exportBackup: 'Export backup',
    importBackup: 'Import backup',
    chooseFile: 'Choose backup file',
    importNote: 'You always get to choose before anything is imported or replaced.',
    storageHeading: 'Storage',
    whereLabel: 'Where is the data?',
    whereValue: 'Only on this device',
    protectedLabel: 'Protected from clearing',
    yes: 'Yes',
    no: 'No',
    unknown: 'Unknown',
    storageBody: 'No login, no accounts and no cloud service. The app works without internet.',
    noBank: 'The app is not connected to any bank. It never moves or withdraws money – you transfer the amounts yourself and confirm them here.',
    installHeading: 'Install on iPhone',
    installBody: 'Open the page in Safari, tap Share and choose “Add to Home Screen”. It then opens like a normal app, even offline.',
    advancedHeading: 'Advanced',
    advancedBody:
      'Raw data is a technical copy of everything that is stored, without any checks. It is meant for troubleshooting and may need help from someone with technical knowledge. Nothing is changed or deleted.',
    saveRaw: 'Save raw data',
  },

  importDialog: {
    title: 'Import backup',
    valid: (count: number) => `The file is valid and contains ${count} ${count === 1 ? 'challenge' : 'challenges'}:`,
    savedOf: (saved: string, target: string) => `${saved} saved of ${target}`,
    legacyBefore: 'This is a backup from an older version of the app. It is added as a ',
    legacyBold: 'new, separate challenge',
    legacyAfter: '. Nothing on this device is replaced.',
    howLegend: 'How do you want to import?',
    addTitle: 'Add as new challenges',
    addDescription: 'Recommended. Your current challenges are kept completely unchanged.',
    replaceTitle: 'Replace everything on this device',
    replaceDescription: (count: number) =>
      `All ${count} current ${count === 1 ? 'challenge' : 'challenges'} are removed and replaced by the contents of the file.`,
    warningLabel: 'Warning:',
    warningText: ' This removes all savings currently on the device. It cannot be undone without a backup.',
    exportFirst: 'Export current data first',
    understand: 'I understand that all current challenges will be replaced.',
    cancel: 'Cancel',
    importAsNew: 'Import as new',
    replaceAll: 'Replace everything',
  },

  recovery: {
    eyebrow: 'Stored data could not be read',
    title: 'Your earlier data is damaged',
    introBefore: 'The app found data stored by an earlier version, but it cannot be read safely. ',
    introBold: 'Nothing has been deleted or changed.',
    step1Title: 'Step 1. Save a copy (recommended)',
    step1Body:
      'Raw data is a technical file that may need help from someone with technical knowledge to be read. Save it anyway, so it is still there if you need it later.',
    saveRaw: 'Save raw data',
    saved: 'The raw data is saved as a file on your device.',
    step2Title: 'Step 2. Continue without the damaged data',
    step2Body:
      'The app then starts without it. The damaged data stays untouched on the device and can be saved as raw data later. You can then create a new challenge or import a backup.',
    continue: 'Continue without the damaged data',
    dialogTitle: 'Continue without the damaged data?',
    dialogConfirm: 'Yes, continue',
    dialogBefore: 'The app starts empty. The damaged data is ',
    dialogBold: 'not',
    dialogAfter: ' deleted – it stays on the device but is not shown.',
    dialogNoCopy: 'You have not saved a copy of the raw data yet. We recommend doing that first.',
  },

  storageProblem: {
    eyebrow: 'Something went wrong',
    title: 'The data could not be opened',
    body: 'Nothing has been changed. You can try again or save a technical copy of everything that is stored.',
    retry: 'Try again',
    saveRaw: 'Save raw data',
  },

  outdated: {
    eyebrow: 'New version',
    title: 'The app needs to reload',
    body: 'Your stored data has been updated by a newer version of the app. Reload to continue. This page saves nothing, so nothing can be damaged.',
    reload: 'Reload',
  },

  notices: {
    raisedCeiling: {
      title: 'A higher daily amount is needed',
      body: (ceiling: string, maximum: string) =>
        `To reach the goal in time, some coming days need to be up to ${ceiling} – more than your highest daily amount of ${maximum}. The ceiling you chose has not been changed; this is the amount required to reach the goal before the end date.`,
    },
    unreachable: {
      title: 'The goal cannot be reached in time',
      body: (target: string, endDate: string, unplanned: string, minimum: string, maximum: string) =>
        `With the days that are left, ${target} cannot be reached by ${endDate}. ${unplanned} is missing from the plan, with daily amounts between ${minimum} and ${maximum}. The end date and the daily amounts are not changed automatically.`,
    },
    endedShort: {
      title: 'The challenge has ended',
      body: (saved: string, target: string) => `You saved ${saved} of ${target}. Your history is kept.`,
    },
    completed: {
      title: 'Goal reached',
      body: (target: string) => `You have saved the full ${target}. Well done!`,
    },
    recoveryImpossible: {
      title: 'The goal can no longer be reached',
      body: (target: string, endDate: string, minimum: string, maximum: string) =>
        `Missed days mean ${target} cannot be reached by ${endDate} with daily amounts between ${minimum} and ${maximum}. The end date is not extended automatically.`,
    },
    recoveryHigherCeiling: {
      title: 'The plan has been recalculated',
      body: (ceiling: string, maximum: string) =>
        `To reach the goal, amounts of up to ${ceiling} per day are now needed – more than your highest daily amount of ${maximum}. The ceiling you chose has not been changed.`,
    },
    recoveryOk: {
      title: 'The plan has been recalculated',
      body: (minimum: string, maximum: string) =>
        `Missed days do not count as saved. The coming amounts have been redistributed and are between ${minimum} and ${maximum} per day.`,
    },
  },

  errors: {
    unchanged: 'Nothing on the device has been changed.',
    backup: {
      notJson: 'The file cannot be read as a backup.',
      wrongFormat: 'The file is not a backup from this app.',
      version: 'The file comes from an unknown or newer version of the app.',
      tooLarge: 'The file is too large to be a backup.',
      tooMany: 'The file contains more challenges than are supported.',
      duplicate: 'The file contains the same challenge more than once.',
      totals: "The amounts in the file do not match the challenge's goal.",
      config: "The challenge settings in the file are invalid.",
      confirmReplace: 'You must confirm that everything should be replaced.',
      legacyReplace: 'An older backup can only be added as a new challenge.',
      unknown: 'The contents of the file are invalid.',
    },
    storage: {
      legacyDamaged: 'The data stored by the previous version is damaged.',
      newerVersion: 'The data on the device comes from a newer version of the app. Reload the app.',
      integrity: 'Stored data could not be verified. Nothing has been changed.',
      database: 'Could not save on the device. Nothing has been changed – try again.',
    },
    domain: {
      alreadyDrawn: "Today's amount has already been drawn.",
      alreadyConfirmed: 'This amount has already been confirmed.',
      drawFirst: "Draw today's amount first.",
      missedDay: 'This day was missed and cannot be drawn.',
      outsideChallenge: "Only today's amount can be drawn and confirmed.",
      generic: 'Something went wrong. Try again.',
    },
  },

  feedback: {
    drawn: "Today's amount is drawn. It only counts as saved once you confirm.",
    confirmed: 'Your saving is confirmed. Well done!',
    created: 'The challenge is created and active.',
    restored: 'The backup is restored.',
    importedOne: 'The challenge was imported as a new challenge.',
    importedMany: (count: number) => `${count} challenges were imported as new.`,
    dateChanged: 'The date has changed. The app has been updated – try again.',
  },

  files: {
    backup: (date: string) => `50k-savings-backup-${date}.json`,
    raw: (date: string) => `50k-savings-raw-data-${date}.json`,
  },
}
