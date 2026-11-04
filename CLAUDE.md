# CLAUDE.md

## Project

**shift-light**: an Expo / React Native app (iPhone first, Android later) that reads engine RPM from a car's OBD-II port through a BLE ELM327-compatible adapter (Vgate vLinker MC+). It flashes the screen and beeps when RPM reaches a user-set threshold, as the signal to shift up.

The full phased plan, architecture and technical background are in **PLAN.md**. Read it before doing anything.

## How to work with me

- Work **one phase at a time**, in order.
- **Before starting a phase:** restate its goal and list the files you will create or change.
- **After finishing a phase:**
  1. Run `npm run format`, then `npm test` and `npx expo lint`.
  2. Summarize what you did and why.
  3. Tell me exactly what I need to verify manually (the phase's "Done when").
  4. **Then stop and wait for me.**
- Do not start the next phase or add features outside the current phase without asking.
- I want to understand how everything works. Briefly explain new concepts and key decisions as you go.
- Steps marked "(You)" in PLAN.md are mine. Tell me when it is my turn and what to do.

## Architecture rules

- `src/core/**` is **pure TypeScript**. It must not import `react`, `react-native`, `expo*`, `net` or `fs`. It must run in Node (tests, scripts) and in the app. ESLint enforces this.
- `src/transports/simulatedCar.ts`, `mock.ts` and `tcp.ts` are pure as well.
- Platform-specific code lives only in:
  - `src/transports/tcpNode.ts` (Node)
  - `src/transports/tcpNative.ts` and `src/transports/ble.ts` (React Native)
- The `Transport` interface lives in `src/core/transport.ts`. Transports implement it.
- Dependency direction: `ui → core ← transports`.
- TypeScript `strict` stays on. Avoid `any`. If it is unavoidable, add a comment explaining why.
- Unit tests use Vitest and sit next to the source as `*.test.ts`.

## Formatting

- **Prettier** owns formatting. The rules are in `.prettierrc.json`: single quotes, semicolons, trailing commas, 100-character lines, 2-space indent, LF line endings.
- ESLint is for code quality only. `eslint-config-prettier` turns off its formatting rules, so the two never conflict.
- All code you write must already match Prettier's output. Run `npm run format` before finishing a phase.
- Don't change `.prettierrc.json` without asking.

## Dependencies

- Expo and React Native packages: `npx expo install <pkg>` (picks SDK-compatible versions).
- Dev tools: `npm i -D <pkg>`.
- Library APIs change. Check the current docs for `expo-audio`, `react-native-ble-plx`, `react-native-tcp-socket` and Expo config plugins instead of relying on memory.

## Safety rules (non-negotiable)

- The ELM327 driver enforces a **command allowlist** (PLAN.md, Section 7). The app is **read-only**:
  - Never send `04`, `2E`, `2F`, `31`, `27`, `ATPP*`, or anything not on the allowlist.
  - Never weaken or bypass the allowlist.
- **Fail safe:** on stale data, errors or disconnect, the light must be OFF and the UI must show "NO DATA".
- The flash pulses at **3 Hz or slower**.

## Useful commands

| Command                     | What it does                                                      |
| --------------------------- | ----------------------------------------------------------------- |
| `npm run format`            | Format the whole project with Prettier                            |
| `npm run format:check`      | Check formatting without changing files                           |
| `npm test`                  | Unit tests (Vitest)                                               |
| `npm run emu:smoke`         | Talk to the ELM327 emulator over TCP (start `elm -n 35000` first) |
| `npm run sim`               | Run the core against the simulated car                            |
| `npx expo start`            | Dev server (Expo Go until Phase 5, dev build from Phase 6)        |
| `npx expo run:ios --device` | Build and install the dev build on the connected iPhone           |
| `npx expo lint`             | Lint, including the purity rule for `src/core`                    |
