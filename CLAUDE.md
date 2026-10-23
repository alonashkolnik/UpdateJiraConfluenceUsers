# Atlassian User Manager

## Project Structure
- **Electron + React + Vite + TypeScript + Tailwind CSS**
- `src/main/` — Electron main process (API calls, auth, file parsing, IPC)
- `src/renderer/` — React UI (components, stores, CSS)
- `src/shared/` — Types and IPC channel constants shared between processes

## Commands
- `npm run dev` — Start Vite dev server with Electron (HMR)
- `npm run build` — TypeScript check + Vite production build
- `npm run package` — Build + create portable Windows EXE
- `npm test` — Build, then run the Playwright suite: the real app against a mock Jira DC / Confluence DC / Cloud server (`test/helpers/atlassian-mock.cjs`). `SKIP_BUILD=1` reuses the last build; `ELECTRON_APP_EXE` targets a packaged build

## Architecture
- **API Layer**: `IAtlassianApi` interface with 3 implementations: CloudApi, JiraDcApi, ConfluenceDcApi
- **State**: Zustand stores (app-store, user-store, action-store)
- **IPC**: Typed invoke/handle pattern via `src/shared/ipc-channels.ts`
- **Auth**: Per-instance session partitions (`persist:atlassian-{hash}`); untrusted DC certificates need the user's confirmation (`src/main/auth/cert-trust.ts`)
- **File Parsing**: SheetJS (xlsx) + PapaParse (csv) with flexible column name mapping
