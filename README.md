# 50K Sparutmaning

A calm, private savings challenge. Each day you draw a random amount and confirm when you have actually saved it.
Local-first and offline: no accounts, no backend, no cloud. The interface is in Swedish.

- Create challenges by choosing a duration (1, 2, 3, 4, 5, 6, 9 or 12 months, or "Till nyår"; six months is the default), a target (default 50,000 SEK) and the lowest and highest daily amount (default 50 and 500 SEK). The challenge starts today (Stockholm time) and the end date and number of days are calculated for you.
- The app is not connected to a bank and never moves money: it draws an amount, you transfer it yourself, then you confirm.
- Run several independent challenges, switch between them, and keep finished ones as history.
- Only confirmed amounts count. Missed days are visible and never count; the plan recalculates without moving the deadline.
- Export and import backups (old v1 files import as a new challenge; v2 files can be added or, after confirmation, replace everything).
- Damaged data from an earlier version can be saved as a raw file and skipped explicitly, without deleting anything.

Live: https://yasinc-clinic.github.io/50k-savings-challenge/

## Develop

```bash
npm install
npm run dev            # local server
npm test               # unit, persistence and component tests (fake IndexedDB, jsdom)
npm run test:coverage  # with coverage
npm run lint
npm run build          # typecheck (tsc -b) + production build
npm run preview        # serve the production build
```

## Documentation

- [Architecture, schema, migration and backups](docs/ARCHITECTURE.md)
- [Release, backup and rollback](docs/RELEASE.md)

## Install on iPhone

Open the published URL in Safari, choose Share, then "Lägg till på hemskärmen". The app works offline after the first load.
Your data stays in the browser on that device: export a backup regularly (Inställningar).
