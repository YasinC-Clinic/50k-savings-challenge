# Release checklist

The live app stores real savings data in each user's IndexedDB. There is no server copy.
Deployment is manual (`Deploy GitHub Pages` workflow, `workflow_dispatch`, `main` only).

Before dispatching a deployment that changes persistence:

1. All CI checks pass on the pull request, including the migration test suite.
2. A real export taken from the currently live app restores correctly in the new build.
3. A copy of a real v1 IndexedDB (taken on a spare browser profile) opens, migrates, and shows identical balances and confirmed days.
4. The v1 tables are still present after migration (rollback safety).
5. The Product Owner has exported a personal backup from the live app first.
6. After deployment: load the live URL, confirm saved total and confirmed days are unchanged, export a backup.

Never experiment on a real user's IndexedDB. Use isolated test databases with fake data.
