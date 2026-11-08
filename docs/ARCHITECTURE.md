# Architecture

A local-first, offline-capable PWA (React 19, TypeScript, Vite, Dexie/IndexedDB). No backend, accounts, sync or
bank integration: every challenge lives only on the device. The interface is Swedish.

## Layers

| Layer | Path | Responsibility |
|---|---|---|
| Domain | `src/domain/challenge.ts` | Pure rules: dates, random amounts, draw, confirm, missed days, recovery, size limits |
| Persistence | `src/persistence/` | Dexie schema, repository, migration, backups, validation, typed errors |
| App state | `src/app/` | `use-savings-app.ts` (state, actions, Stockholm "today"), `savings-view.ts` (view models) |
| UI | `src/ui/`, `src/App.tsx` | Screens and dialogs. No database terms are shown to the user |

## Challenge rules

- A challenge has a `ChallengeConfig`: `targetSek`, `startDate`, `endDate`, `initialMinimumSek` (50), `preferredMaximumSek` (500).
- The original challenge: 50,000 SEK, 2027-01-01 to 2027-06-30 (181 days). It stays as it is.
- **New challenges are created by duration**, never by typing dates. The person picks 1, 2, 3, 4, 5, 6 (default), 9 or 12 months,
  or **Till nyår**; the start date is today in `Europe/Stockholm` and the end date is calculated.
- **Till nyår** ends on 31 December of the start year (8 Nov 2026 gives 31 Dec 2026, 54 days). If the challenge would start on
  31 December itself, it ends on the next 31 December instead of becoming an empty challenge.
- **Daily limits are per challenge.** The creation form lets the user choose the lowest and highest amount of a day (defaults 50 and 500
  SEK; whole kronor, minimum at least 1, minimum not above maximum, maximum at most 100,000). They are stored in the challenge config
  (`initialMinimumSek`, `preferredMaximumSek`), so different challenges can use different limits and existing challenges keep theirs.
  There is no schema change: configs always carried both fields. Allocation and recovery read the challenge's own limits.
- Recovery never changes the chosen maximum. If reaching the target needs a higher daily amount, the app says so (a warning on Home
  with the exact amount needed) and the configured maximum stays as chosen; if the target cannot be reached, it says why.
- The app is **not connected to a bank**. It draws a random amount; the user transfers the money themselves and then confirms. The calculated dates are stored in the same
  `startDate`/`endDate` fields as before, so there is no schema change and existing challenges are never recalculated.
- **Month rule** (`addMonths`): keep the day of the month; if the target month is shorter, use its last day. 8 Nov + 6 months = 8 May;
  31 Jan + 1 month = 28 Feb (29 Feb in a leap year); 31 Mar + 1 month = 30 Apr; 29 Feb + 12 months = 28 Feb. It is pure
  year/month/day arithmetic with no `Date`, UTC or time zone, so daylight saving cannot move a date. The number of days is the real
  calendar count from start to end, both included (six months from 8 Nov 2026 is 182 days).
- The daily amounts are limited to 50-500 SEK, so a target only fits a period holding enough days: 50,000 SEK needs at least 4 months.
  The form says exactly what is possible and blocks creation otherwise.
- Daily amounts are random integers (seeded), totalling exactly the target. An amount is hidden until drawn; a drawn amount is fixed;
  only a **confirmed** amount counts as saved; confirmed amounts are immutable.
- Only today (Europe/Stockholm) can be drawn or confirmed. Earlier unresolved days become **missed** and never count.
- Recovery redistributes only undrawn days from today to the deadline. If that needs more than the preferred maximum the
  UI says so; if the target cannot be reached it says so. The end date is never moved automatically.
- Limits (`CHALLENGE_LIMITS`): 1,100 days, 10,000,000 SEK target, 100,000 SEK preferred daily maximum, 50 challenges per backup.
- Dates are calendar strings (`YYYY-MM-DD`) handled without time-zone conversion; "today" is derived with `Intl` in `Europe/Stockholm`.

## Database (Dexie, IndexedDB name `50k-savings-challenge`)

| Table | Key | Version | Purpose |
|---|---|---|---|
| `challenges` | `id` | v1 | Legacy: one row `{ id: 'active', seed }`. **Never written by v2 code** |
| `dailyEntries` | `date` | v1 | Legacy: 181 rows. **Never written by v2 code** |
| `challengeRecords` | `id` | v2 | `{ id, seed, config, origin, createdAt, name?, sourceChallengeId? }` |
| `challengeEntries` | `[challengeId+date]` | v2 | `{ challengeId, date, amount, status }`; the compound key keeps overlapping challenges apart |
| `appMeta` | `key` | v2 | `activeChallengeId`, `legacyMigration` status |

`origin` is one of `created`, `legacy-v1-migration`, `legacy-v1-backup`, `backup-import`, `backup-restore` and drives the labels
shown on the challenge list. Every read and write is scoped by `challengeId` (`SavingsDatabase.entriesOf`).

## Migration from v1

On first use after the update, `migrateLegacyData` runs once inside **one transaction**:

1. Read the v1 tables and validate them against the default config (exact total is not required, so legitimate history with
   missed days is accepted).
2. Valid: write one challenge `legacy-v1-challenge` (origin `legacy-v1-migration`), make it active, record `legacyMigration: migrated`.
3. Empty (no rows, or a marker row without entries): record `legacyMigration: empty`.
4. Damaged (partial, corrupt, orphan entries): write **nothing** and raise `LegacyDataDamagedError`.

The v1 tables are never modified or deleted, which keeps rollback and raw recovery possible. If the transaction fails, nothing is
written and the migration is retried on the next start.

### Damaged data

The app shows a recovery screen. The user can (1) save a raw copy (`exportRawLegacyData`: a read-only connection that validates
nothing and changes nothing), then (2) explicitly continue without the damaged data (`skipDamagedLegacyData`, which records
`legacyMigration: skipped` and leaves the v1 tables untouched). Raw export includes every table, so damaged v2 data can be saved too.

## Backups

File format `50k-savings-challenge-backup`:

- **v2** `{ format, version: 2, exportedAt, activeChallengeId, challenges: [{ id, seed, config, days, origin?, name? }] }`. Deterministic.
- **v1** (files exported by the first release) `{ format, version: 1, exportedAt, challenge: { seed, days } }`. Accepted forever.

`restoreBackup(json, options)` validates the **whole file** before the first write and then applies it in one transaction:

| File | Option | Effect |
|---|---|---|
| v1 | `import-as-new` (only choice) | Added as one new challenge with a new id; nothing is replaced |
| v2 | `import-as-new` | Every challenge gets a new id; existing challenges are untouched; ids can never collide |
| v2 | `replace` + `confirmReplace: true` | All challenges are replaced by the file's content |

Validation rejects wrong format/version, non-ISO timestamps, duplicate ids, unknown active id, invalid or unreachable configs,
amounts outside bounds, wrong day counts or order, totals that do not match the target (v2 and v1 files without missed days),
more than 50 challenges and files over 20 MB. All problems are `BackupValidationError`s; nothing on the device changes.

## Errors

`BackupValidationError` (bad file), `PersistenceIntegrityError` (damaged or rule-breaking data; `LegacyDataDamagedError` for v1),
`PersistenceDatabaseError` (browser storage failure; `PersistenceVersionError` when a newer app version upgraded the data). The UI
turns each into plain Swedish (`src/ui/sv.ts`).

## PWA and dates

- Offline: Workbox precaches the app shell; data is local.
- Updates: `autoUpdate` activates a new service worker automatically. This cannot corrupt data: writes are atomic, and an
  older copy that meets a database upgraded by a newer version stops and asks to reload (`OutdatedScreen`) instead of writing.
- The date refreshes at Stockholm midnight (timer computed on the real date change, correct on 23- and 25-hour DST days) and
  whenever the app becomes visible again. Draw and confirm re-check the date and refuse to act on a stale day.
- The app asks the browser for persistent storage and shows the result in Settings.

## Known limitations

- Data lives in one browser on one device. Clearing site data or uninstalling the app deletes it: export backups regularly.
- No automatic backups. No deletion of challenges (history is preserved by design).
- The service worker and installation on iPhone have been built to standard PWA practice but have not been verified on a physical iPhone.
- Challenges that are not active are brought up to date (missed days, recovery) only when they become active.
