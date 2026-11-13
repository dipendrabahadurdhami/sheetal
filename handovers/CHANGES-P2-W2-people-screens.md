# CHANGES P2-W2 People screens on the kit

- `business/frontend/src/pages/LivePeople.jsx` moved to `apps/people/frontend/pages/PeoplePage.jsx`; the old file is a one-line shim (deleted at the end of Phase 2).
- On the kit: `@sheetal/ui/primitives`, `useApiGet` from `@sheetal/sdk/hooks` (reloads on business, branch and after a change; errors shown as before), `exportCsv` from the kit.
- Sends `version` with a fix, a leave-type edit and a decision; a stale page (409) closes the form and reloads.
- Wiring: `apps/people/package.json` exports `./frontend`; `business/frontend` depends on `@sheetal/app-people` and its Vite config points at the folder.
- Test: `apps/people/frontend/pages/PeoplePage.test.js`. No old test changed.
