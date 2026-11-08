# Release, backup and rollback

The live app stores real savings data in each user's IndexedDB. There is no server copy.
Deployment is manual: the `Deploy GitHub Pages` workflow (`workflow_dispatch`, `main` only). Merging never deploys by itself.
CI (`ci.yml`) runs tests, lint and build on every pull request and branch push and cannot deploy.

## Before releasing a change that touches persistence

1. All CI checks pass, including the migration, backup, recovery and component tests.
2. A real export from the currently live app restores correctly in the new build (v1 file imports as a new challenge).
3. A copy of a real v1 database on a spare browser profile opens, migrates, and shows identical balances and confirmed days.
4. The v1 tables (`challenges`, `dailyEntries`) are still present after migration.
5. The Product Owner has exported a personal backup from the live app (Settings, Exportera säkerhetskopia) **before** the update.

## Release steps

```bash
npm ci && npm test && npm run lint && npm run build   # local verification
git push origin <feature-branch>                        # CI runs
# merge the pull request into main, then:
gh workflow run "Deploy GitHub Pages" --ref main        # manual deploy
```

After deploying: open the live URL, confirm the saved total and confirmed days are unchanged, and export a fresh backup.

## Rollback

- The previous version can be redeployed by running the workflow from the previous good commit's merge (`git revert` the merge on `main`, then dispatch).
- The v1 tables are never modified, so the old data is still on the device. Be aware that the database is now at schema version 2:
  an older build refuses to open it (`VersionError`) rather than writing to it. Restore from a backup file if a downgrade is ever needed.
- Backups are the recovery path: a v1 file imports into any newer version; a v2 file restores by replace or as new challenges.

## Backup procedure for users

Settings, Exportera säkerhetskopia, keep the `.json` file somewhere safe (iCloud Drive, email). To restore: Settings, Importera
säkerhetskopia, read the explanation, choose "Lägg till som nya" (safe) or "Ersätt allt" (needs an explicit confirmation).

## Testing safely

Never experiment with real IndexedDB data. Tests use isolated, randomly named fake databases (`fake-indexeddb`).
