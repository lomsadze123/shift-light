# Shift Light — Project Plan

A step-by-step, phased plan for building an iPhone app (Android later) that reads engine RPM from a car's OBD-II port and tells the driver when to shift up, by flashing the whole screen and playing a sound.

This file is written for two readers: **you** (the human) and **Claude Code**. Every phase says _what_ to build, _where_ the work happens, _how_ to verify it, and _what to keep in mind for later_.

---

## 1. Goal and scope

**Goal:** the driver sets a target RPM (for example 5800). While driving an automatic in manual (M) mode, the phone flashes full-screen and beeps when the engine reaches that RPM, as the signal to shift up.

**In scope:**

- Reading RPM over a Bluetooth Low Energy (BLE) ELM327-compatible adapter (planned: **Vgate vLinker MC+**, BLE 4.0 / iOS version).
- An adjustable threshold that is saved on the phone.
- A full-screen flash and a sound that also plays when the iPhone's silent switch is on.
- Working on (almost) any OBD-II car. RPM is standard PID `0x0C`, which is universally supported.

**Out of scope for now:** temperatures, fault codes (DTC), trip logs and statistics, and writing anything to the car.

---

## 2. How it works (big picture)

```
Car ECU ──CAN──▶ OBD-II port ──▶ Adapter (ELM327 over BLE)
                                        │
                                        ▼
                                  BleTransport          ← the only part that changes
                                        │                  between dev and the real car
                                        ▼
                                  Elm327 driver         (text commands, '>' prompt, queue)
                                        │
                                        ▼
                                  RpmPoller             (asks for RPM as fast as possible)
                                        │
                                        ▼
                                  ShiftLight logic      (threshold + prediction + hysteresis)
                                        │
                                        ▼
                                  UI                    (big RPM number, flash, beep)
```

During development the top part is replaced by:

- **MockTransport**: a simulated car that accelerates and shifts gears, running inside the app or in Node.
- **TcpTransport**: talks to the **ELM327-emulator** running on the Mac, from Node or from the iPhone over Wi-Fi.

Everything below the transport is identical in all three cases. That is the core idea of the architecture.

---

## 3. Key technical facts (read before coding)

**ELM327 protocol basics**

- Commands are ASCII text ending with `\r`, for example `010C\r`.
- The adapter answers with text and finishes every answer with the prompt character `>`.
- The adapter handles **one command at a time**. Never send a new command before `>` arrives. Doing so causes `STOPPED` errors and garbage.
- Answers arrive in **arbitrary chunks** (BLE notifications, TCP packets). Always buffer until `>`.

**RPM**

- Request: `010C` (mode 01, PID 0C).
- Response: `41 0C A B`, where RPM = `(A × 256 + B) / 4`.
- With spaces disabled (`ATS0`) the response looks like `410C1AF8`. Here A = 0x1A = 26 and B = 0xF8 = 248, so RPM = (6656 + 248) / 4 = **1726**.
- `010C1` (with a trailing `1`) tells the adapter "expect exactly one response, return immediately". This saves tens of milliseconds per request. Some clones and emulators may not support it, so the driver must detect this and fall back to `010C`.

**Speed and latency (why prediction is needed)**

- A BLE ELM327 gives roughly 8–15 responses per second at best, with about 60–150 ms round trip.
- In 1st gear the RPM can rise about 3000 RPM per second, so 100 ms of delay is about 300 RPM of overshoot.
- Therefore the shift light estimates how fast RPM is rising and fires slightly **before** the threshold. The lead time is calibrated in the car (Phase 8).

**BLE on iOS**

- `react-native-ble-plx` reads and writes characteristic values as **base64 strings**.
- BLE does **not** work in the iOS Simulator. A real iPhone is required.
- iOS apps do not pair with ELM327 BLE adapters through Settings. The app scans and connects by itself.

**Expo**

- Phases 0–5 run in **Expo Go**, because no custom native modules are used yet.
- From Phase 6 on, the app needs a **development build** (`expo-dev-client`), because `react-native-tcp-socket` and `react-native-ble-plx` are native modules.

---

## 4. Project structure (final state)

```
shift-light/
├── App.tsx                        # root component, renders ShiftLightScreen
├── index.ts                       # Expo entry (from template)
├── app.json                       # Expo config (bundle id, permissions, plugins)
├── CLAUDE.md                      # rules for Claude Code
├── PLAN.md                        # this file
├── assets/
│   └── beep.wav                   # generated in Phase 5
├── scripts/                       # Node-only experiments, run with `tsx`
│   ├── emulator-smoke.ts          # Phase 1–2: talk to ELM327-emulator over TCP
│   ├── simulate.ts                # Phase 3–4: run the whole core against MockTransport
│   └── make-beep.ts               # Phase 5: generate assets/beep.wav
├── src/
│   ├── core/                      # PURE TypeScript: runs in Node AND React Native
│   │   ├── transport.ts           # Transport interface
│   │   ├── elm327.ts              # ELM327 driver: queue, init, send, errors, allowlist
│   │   ├── elm327.test.ts
│   │   ├── rpm.ts                 # parse "410C1AF8" → 1726
│   │   ├── rpm.test.ts
│   │   ├── rpmPoller.ts           # back-to-back polling, stats, stale/disconnect
│   │   ├── rpmPoller.test.ts
│   │   ├── shiftLight.ts          # threshold + prediction + hysteresis (pure)
│   │   ├── shiftLight.test.ts
│   │   └── debugLog.ts            # ring buffer of raw TX/RX lines
│   ├── transports/
│   │   ├── simulatedCar.ts        # pure: physics-ish RPM simulation
│   │   ├── mock.ts                # pure: MockTransport answering like an ELM327
│   │   ├── tcp.ts                 # pure: TcpTransport over a "SocketLike"
│   │   ├── tcpNode.ts             # Node only: SocketLike from `net` (scripts)
│   │   ├── tcpNative.ts           # RN only: SocketLike from react-native-tcp-socket (Phase 6)
│   │   └── ble.ts                 # RN only: react-native-ble-plx (Phase 7)
│   └── ui/
│       ├── ShiftLightScreen.tsx   # the one and only screen
│       ├── useShiftLight.ts       # hook wiring transport → driver → poller → logic
│       ├── FlashOverlay.tsx
│       ├── RpmDisplay.tsx
│       ├── ThresholdControl.tsx
│       ├── ConnectionPicker.tsx   # Mock | TCP | BLE
│       ├── ConnectionStatus.tsx   # Hz, round-trip time, connection state
│       ├── DebugPanel.tsx         # last raw lines, toggleable
│       └── settings.ts            # AsyncStorage persistence
├── .vscode/
│   ├── settings.json              # Prettier on save, ESLint fix on save
│   └── extensions.json            # recommended extensions
├── .prettierrc.json               # formatting rules
├── .prettierignore
├── eslint.config.js               # Expo config + core purity rule + prettier
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

**Dependency direction:** `ui → core ← transports`. `src/core` never imports from `ui` or from React Native. Transports implement the interface defined in `src/core/transport.ts`.

---

## 5. Architecture rules

1. `src/core/**`, `src/transports/simulatedCar.ts`, `mock.ts` and `tcp.ts` are **pure TypeScript**: no `react`, `react-native` or `expo*` imports, and no Node-only modules (`net`, `fs`). They must run both in Node (tests, scripts) and in the app.
2. Platform-specific code lives only in `tcpNode.ts` (Node), and in `tcpNative.ts` and `ble.ts` (React Native).
3. TypeScript `strict` stays on.
4. Unit tests use **Vitest** and sit next to the source as `*.test.ts`.
5. The ELM327 driver enforces a **command allowlist** (see Section 7). The app is read-only.
6. **Fail safe:** if data is stale or the connection drops, the light must turn **off** and the UI must clearly show "NO DATA".

---

## 6. Phases

Each phase lists: **Goal**, **Where** the work happens, **Steps**, **Done when**, and **Notes for later**.
Do the phases in order. Do not start a phase until the previous one's "Done when" is true.

---

### Phase 0 — Environment and scaffold

**Goal:** tools installed, empty Expo app running on the iPhone, project skeleton in place.

**Where:** Mac terminal, App Store, iPhone, VS Code.

#### 0A — Done by you, manually

1. Install **Node.js LTS** (20 or newer) and check it with `node -v`.
2. Install **Git** and **VS Code** if missing.
3. Install **Xcode** from the App Store (large download, start early). Open it once so it installs its components, then run `xcode-select --install`.
4. Install the **ELM327 emulator**. macOS Homebrew Python blocks global `pip install`, so use pipx:
   ```
   brew install pipx
   pipx ensurepath
   pipx install ELM327-emulator
   ```
   Check it with `elm -h`.
5. Install **Expo Go** on the iPhone from the App Store.
6. Create the project:
   ```
   npx create-expo-app@latest shift-light --template blank-typescript
   cd shift-light
   ```
7. Copy `PLAN.md` and `CLAUDE.md` into the project root.
8. Run `code .`, then make the first commit.
9. Check it works: run `npx expo start` and scan the QR code with the iPhone camera. The blank app should open in Expo Go. The Mac and the iPhone must be on the same Wi-Fi.

#### 0B — Done by Claude Code

1. Install dev tools: `npm i -D tsx vitest @types/node`.
2. Create the folders from Section 4: `src/core`, `src/transports`, `src/ui`, `scripts`.
3. Add `vitest.config.ts`: Node environment, include `src/**/*.test.ts`.
4. Add `package.json` scripts:
   - `"test": "vitest run"`
   - `"test:watch": "vitest"`
   - `"emu:smoke": "tsx scripts/emulator-smoke.ts"`
   - `"sim": "tsx scripts/simulate.ts"`
5. Confirm `tsconfig.json` has `"strict": true`.
6. Set up ESLint with `npx expo lint`. Add a `no-restricted-imports` override for `src/core/**` that forbids `react`, `react-native`, `expo*`, `net` and `fs`.
7. Set up **Prettier** (formatting) so it works together with ESLint:
   - `npm i -D prettier eslint-config-prettier`
   - Add `eslint-config-prettier` as the **last** entry in `eslint.config.js`, so ESLint never fights Prettier over formatting.
   - `.prettierrc.json`:
     ```json
     {
       "semi": true,
       "singleQuote": true,
       "trailingComma": "all",
       "printWidth": 100,
       "tabWidth": 2,
       "arrowParens": "always",
       "endOfLine": "lf"
     }
     ```
   - `.prettierignore`: `node_modules`, `.expo`, `ios`, `android`, `dist`, `coverage`, `package-lock.json`.
   - `package.json` scripts: `"format": "prettier --write ."` and `"format:check": "prettier --check ."`.
   - `.vscode/settings.json`: Prettier as the default formatter, format on save.
     ```json
     {
       "editor.defaultFormatter": "esbenp.prettier-vscode",
       "editor.formatOnSave": true,
       "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" }
     }
     ```
   - `.vscode/extensions.json`: recommend `esbenp.prettier-vscode` and `dbaeumer.vscode-eslint`.
   - Run `npm run format` once on the whole project and commit it as a separate "format" commit.
8. Add one trivial test so `npm test` runs green.

**Done when:**

- `npm test` passes.
- `npx expo lint` passes.
- `npm run format:check` passes.
- Saving a file in VS Code formats it automatically.
- The app opens in Expo Go on the iPhone.

**Notes for later:**

- On the iPhone, **Developer Mode** will be needed in Phase 6 (Settings → Privacy & Security → Developer Mode, then restart).
- Keep `src/core` pure. If it ever imports React Native, Node tests and scripts break.

---

### Phase 1 — Transport interface and TCP transport (Node)

**Goal:** Node code can send text to the ELM327 emulator and receive raw answers.

**Where:** VS Code and two Mac terminals.

**Steps (Claude Code):**

1. `src/core/transport.ts` defines the interface:
   ```ts
   export interface Transport {
     connect(): Promise<void>;
     disconnect(): Promise<void>;
     write(text: string): Promise<void>;
     onData(listener: (chunk: string) => void): () => void; // returns unsubscribe
     onClose(listener: (error?: Error) => void): () => void;
     readonly isConnected: boolean;
   }
   ```
2. `src/transports/tcp.ts` implements `TcpTransport` on top of a minimal `SocketLike` type (`write`, `destroy`, `on('data' | 'error' | 'close')`) and a factory function `(host, port) => SocketLike`. It contains no platform imports. Decode bytes as ASCII/latin1.
3. `src/transports/tcpNode.ts` provides the factory using Node's `net.createConnection`.
4. `scripts/emulator-smoke.ts` connects to `localhost:35000`, sends `ATZ`, `ATE0`, `ATS0` and `010C` one by one, waits for `>` after each, and prints the raw answers with `\r` shown visibly (for example as `⏎`).

**How you run it:**

- Terminal 1: `elm -n 35000` (leave it running).
- Terminal 2: `npm run emu:smoke`.

**Done when:** you see the emulator's ELM327 version string and a line starting with `410C` (or `41 0C`).

**Notes for later:**

- Chunk boundaries are random. Never assume one `data` event equals one answer.
- The same `tcp.ts` is reused on the iPhone in Phase 6, just with a different factory.

---

### Phase 2 — ELM327 driver and RPM decoder

**Goal:** a robust driver that initializes the adapter, sends one command at a time and returns clean answers, plus a tested RPM parser.

**Where:** VS Code, terminal.

**Steps (Claude Code):**

1. `src/core/rpm.ts`, `parseRpm(lines: string[]): number | null`:
   - Ignore whitespace, `SEARCHING...` and empty lines.
   - Find the first `410C` followed by 4 hex characters. If several ECUs answer, take the first.
   - Return `(A*256 + B) / 4`, validated to the range 0–16383.75. Otherwise return `null`.
2. `src/core/elm327.ts`, class `Elm327`:
   - Constructor takes a `Transport` and an optional `DebugLog`.
   - `send(command, { timeoutMs })`: put the command in a **queue** (promise chain) so only one is in flight. Write `command + '\r'`, buffer incoming chunks until `>`, then split into lines and strip echo and noise.
   - Map error answers to typed errors: `NO DATA` → `NoDataError`, `?` → `UnsupportedCommandError`, `UNABLE TO CONNECT`, `CAN ERROR`, `BUS INIT...ERROR`, `STOPPED`, and timeouts → `TimeoutError`.
   - **Allowlist** (Section 7): reject anything not explicitly allowed _before_ writing it.
   - `init()` sequence:
     - `ATZ` (timeout about 2 s, response content ignored)
     - `ATE0`, `ATL0`, `ATS0`, `ATH0`, `ATSP0`
     - `ATAT2` (adaptive timing; treat `?` as non-fatal)
     - `0100` with a long timeout (about 10 s), because the first request triggers the protocol search and may print `SEARCHING...`
   - `detectFastRpm()`: try `010C1` once. If the answer is valid, use it from then on. Otherwise fall back to `010C`.
   - `readRpm()`: sends the chosen RPM command and returns `parseRpm(...)`.
   - Write every TX and RX line to `DebugLog`.
3. `src/core/debugLog.ts`: a ring buffer of the last ~300 entries `{ t, dir: 'tx' | 'rx' | 'info' | 'error', text }` with a subscribe API.
4. Tests:
   - `rpm.test.ts`: with and without spaces, `SEARCHING...` prefix, multiple lines, `NO DATA`, garbage input, boundary values.
   - `elm327.test.ts`: uses a scripted fake transport that splits answers into random chunks. Covers queue ordering, timeout handling, error mapping, the allowlist rejecting forbidden commands, and the `010C1` → `010C` fallback.
5. Update `scripts/emulator-smoke.ts` to use `Elm327`: run `init()` and then print 20 RPM readings with timestamps.

**Done when:** `npm test` passes and `npm run emu:smoke` prints RPM values from the emulator.

**Notes for later:**

- `ATZ` is slow on real adapters. Some clones still echo the first command even after `ATE0`, and the parser must tolerate that.
- If the emulator rejects `010C1`, that is fine. The fallback path is exactly what this tests.

---

### Phase 3 — Mock car (simulated transport)

**Goal:** a fake car that behaves realistically (accelerates, shifts, has latency), so the shift light can be developed without the emulator or a real car. The emulator barely changes RPM, so it is not enough for this.

**Where:** VS Code, terminal.

**Steps (Claude Code):**

1. `src/transports/simulatedCar.ts`:
   - Idle about 800 RPM, redline about 6800 RPM.
   - Gears 1–6 with full-throttle RPM rise rates of roughly `[3200, 2400, 1800, 1300, 1000, 800]` RPM per second.
   - On a shift, RPM drops by the gear ratio step (for example from 6000 to about 3900).
   - Scenarios:
     - `pull`: full throttle, shifts at a configurable RPM.
     - `cruise`: steady RPM with small noise.
     - `random`: mixed throttle.
   - Uses an injectable clock (`now()`) so tests are deterministic.
2. `src/transports/mock.ts`, `MockTransport implements Transport`:
   - `AT*` answers `OK`, `ATZ` answers `ELM327 v1.5`, `0100` answers a plausible supported-PIDs reply.
   - `010C` and `010C1` answer with the encoded current RPM (`410C` + 4 hex).
   - Anything else answers `NO DATA`.
   - Simulated latency of 60 ms plus 0–60 ms of jitter. About 1% of requests time out, to exercise the error paths.
   - Answers are split into random chunks and end with `\r\r>`.
3. `scripts/simulate.ts`: runs `Elm327` + `MockTransport` and prints RPM, samples per second and average round-trip time.

**Done when:** `npm run sim` shows RPM climbing, dropping at each shift, at about 8–12 samples per second.

**Notes for later:** `MockTransport` is also the default connection in the app during Phase 5. It is the fastest way to test the UI.

---

### Phase 4 — RPM poller and shift-light logic

**Goal:** continuous RPM sampling, plus the decision logic "should the light be on right now?", fully unit-tested.

**Where:** VS Code, terminal.

**Steps (Claude Code):**

1. `src/core/rpmPoller.ts`:
   - `start()` / `stop()`. Requests run back-to-back: the next request starts as soon as the previous one finishes, with no fixed interval.
   - Each sample is `{ rpm, t }`, where `t` is the **midpoint** between send time and receive time. This is the best estimate of when the ECU measured it.
   - Stats: samples per second, average and p95 round-trip time, error count.
   - After N consecutive errors (for example 5), the state becomes `disconnected` and the poller emits an event.
   - Emits `sample`, `stats` and `state` events through a tiny typed event emitter, with no Node `events` import.
2. `src/core/shiftLight.ts`, a pure function or class:
   - Config: `{ thresholdRpm, hysteresisRpm = 200, leadMs = 150, minOnMs = 300, staleMs = 500 }`.
   - `update(sample | null, now) → { active, rpm, predictedRpm, ratePerSec, stale }`.
   - **Rate:** linear regression over the samples from the last ~600 ms (at least 3 samples).
   - **Prediction:** `predictedRpm = rpm + rate × (leadMs + (now − sample.t)) / 1000`. Only used when the rate is positive.
   - **Turn on:** `rpm ≥ threshold` OR (`rate > 0` AND `predictedRpm ≥ threshold`).
   - **Turn off:** `rpm < threshold − hysteresis` AND `predictedRpm < threshold` AND the light has been on for at least `minOnMs`.
   - **Stale:** if no sample has arrived for more than `staleMs`, the light is off and `stale = true`.
3. Tests (`shiftLight.test.ts`, `rpmPoller.test.ts`):
   - A steady climb triggers _before_ the threshold by about `rate × leadMs`.
   - Noisy RPM around the threshold does not flicker.
   - The RPM drop after a shift turns the light off.
   - Falling RPM never triggers early.
   - Stale data turns the light off.
   - The poller reports `disconnected` after repeated errors.
4. Extend `scripts/simulate.ts`: for each simulated pull, print the RPM at which the light fired versus the threshold.

**Done when:** all tests pass, and in `npm run sim` the light fires within about ±100 RPM of the threshold.

**Notes for later:**

- `leadMs` is the main calibration knob for Phase 8. Keep it adjustable at runtime.
- Never let prediction fire on decreasing RPM. This is a safety and annoyance rule.

---

### Phase 5 — The UI (Expo Go, using the mock car)

**Goal:** the complete app experience on the iPhone, driven by `MockTransport`.

**Where:** VS Code, the iPhone in Expo Go.

**Steps (Claude Code):**

1. Install with `npx expo install` (this picks versions compatible with the Expo SDK):
   - `expo-keep-awake`
   - `expo-audio`
   - `@react-native-async-storage/async-storage`
   - `expo-haptics` (optional)
2. `scripts/make-beep.ts`: generates `assets/beep.wav`, a short sine tone of about 1 kHz and about 120 ms. Add an npm script for it.
3. `src/ui/useShiftLight.ts`: owns the pipeline (transport → `Elm327` → `RpmPoller` → `shiftLight`). It exposes `{ connection, rpm, active, stats, connect(kind, options), disconnect() }` and re-renders only on new samples.
4. Components:
   - **`RpmDisplay`**: huge digits, readable at a glance.
   - **`FlashOverlay`**: full-screen bright color pulsing at **2–3 Hz** while active (never faster than 3 Hz, see Section 7).
   - **`ThresholdControl`**: −100 / +100 buttons (long press = ±500). Saved with AsyncStorage through `settings.ts`.
   - **`ConnectionPicker`**: Mock (enabled), TCP host:port (disabled until Phase 6), BLE (disabled until Phase 7).
   - **`ConnectionStatus`**: state, samples per second, round-trip time.
   - **`DebugPanel`**: toggleable list of the last raw TX/RX lines from `DebugLog`.
5. **Sound:** while the light is active, play the beep in a loop or repeatedly. Configure the audio session so it plays even with the **silent switch on** (`expo-audio`'s audio mode setting for silent mode; check the current API in the docs).
6. `useKeepAwake()` on the screen so it never sleeps.
7. Dark background, high contrast, and landscape friendly (`app.json` → `"orientation": "default"` or landscape-locked).
8. A hidden "advanced" section exposing `leadMs` and `hysteresisRpm` (needed in Phase 8).

**Done when:** in Expo Go, in Mock mode, the RPM climbs and at the threshold the screen flashes and beeps, **even with the silent switch on**. The screen does not sleep, and the threshold survives an app restart.

**Notes for later:**

- Test the flash color in bright daylight later. Contrast matters more than style.
- Keep the render path light. Only the RPM number and the overlay should update often.

---

### Phase 6 — Development build on the iPhone + TCP over Wi-Fi

**Goal:** the app runs as a development build on the iPhone and reads RPM from the emulator on the Mac over Wi-Fi.

**Where:** Mac terminal, Xcode, the iPhone (USB cable for the first install).

**Steps:**

1. (Claude Code) `npx expo install expo-dev-client react-native-tcp-socket`.
2. (Claude Code) `app.json`:
   - `ios.bundleIdentifier`, for example `com.<yourname>.shiftlight`. Ask the human which name to use.
   - `ios.infoPlist.NSLocalNetworkUsageDescription`, for example "Connects to an OBD emulator on your local network during development."
3. (Claude Code) `src/transports/tcpNative.ts`: a `SocketLike` factory using `react-native-tcp-socket`. Enable the TCP option in `ConnectionPicker`, with the host and port saved in settings.
4. (You) On the iPhone, turn on **Developer Mode**: Settings → Privacy & Security → Developer Mode, then restart.
5. (You) Connect the iPhone by USB and run:
   ```
   npx expo run:ios --device
   ```
   - When asked about code signing, pick your personal team (your Apple ID). If that fails, open `ios/*.xcworkspace` in Xcode → target → Signing & Capabilities → set Team, then run again.
   - On the iPhone, trust the developer profile: Settings → General → VPN & Device Management.
6. (You) Daily development after that: `npx expo start`, then open the dev build (not Expo Go).
7. (You) Start the emulator with `elm -n 35000`. Find the Mac's IP with `ipconfig getifaddr en0`. In the app, choose TCP, enter `IP:35000`, connect, and allow the **Local Network** prompt.

**Done when:** the iPhone app shows RPM coming from the emulator over Wi-Fi, and the Debug panel shows the raw traffic.

**Notes for later:**

- Builds signed with a free Apple ID **expire after 7 days**. Re-run `npx expo run:ios --device`.
- Once native modules are added, Expo Go no longer works for this project. Always use the dev build.
- The `ios/` folder is generated. Add it to `.gitignore` unless you ever need manual native edits.
- If the phone can't connect: check that the emulator listens on all network interfaces, not only localhost (see `elm -h`), and check the macOS firewall.

---

### Phase 7 — BLE transport (the real adapter)

**Goal:** connect to the vLinker MC+ over BLE and read live RPM from a real car.

**Where:** VS Code, Mac terminal, the iPhone, the car (parked).

**Steps:**

1. (You) **First verify the hardware** with an existing app (for example Car Scanner) in the car. This proves the adapter and car work before debugging your own code.
2. (Claude Code) `npx expo install react-native-ble-plx`. Add its Expo **config plugin** to `app.json` with a Bluetooth permission message (check the library's README for the current plugin options). Rebuild with `npx expo run:ios --device`.
3. (Claude Code) `src/transports/ble.ts`, `BleTransport implements Transport`:
   - **Scan:** show nearby devices to the user, sorting names containing `vLinker`, `OBD` or `ELM` first. Remember the chosen device ID in settings for auto-reconnect.
   - **Connect** → `discoverAllServicesAndCharacteristics()`.
   - **Auto-select characteristics:** one that supports notify (incoming data) and one that supports write (outgoing), preferring the same service. Common UUIDs are `FFF0/FFF1/FFF2` or `FFE0/FFE1`, but **do not hardcode them**. Log every discovered service and characteristic UUID to `DebugLog`.
   - **Encoding:** base64 ↔ ASCII. Use global `atob`/`btoa` (available in Hermes) or the `base-64` package.
   - **Writes:** use write-without-response if supported, otherwise write-with-response. Commands are short, so MTU is not an issue.
   - **Disconnect handling:** emit `onClose`, which stops the poller and shows "NO DATA" in the UI.
4. (Claude Code) Enable BLE in `ConnectionPicker`.
5. (You) In the car, parked, with ignition on and engine running: connect and compare the app's RPM with the dashboard tachometer.

**Done when:** live RPM in the app matches the tachometer, and the stats show a stable sample rate.

**Notes for later:**

- BLE ELM327 adapters often connect **without pairing**. Unplug the adapter when you are not using it (security, and a small battery drain).
- BLE cannot be tested in the iOS Simulator.
- If the scan finds nothing: check that the iPhone's Bluetooth permission for the app is granted, and that the adapter's LED shows it is powered.

---

### Phase 8 — In-car calibration and testing

**Goal:** the flash fires consistently within about 100–200 RPM of the threshold in the gears you actually use.

**Where:** the car. **A passenger operates the phone.**

**Steps (you, with Claude Code adjusting code as needed):**

1. **Measure the link.** Note samples per second and round-trip time in `ConnectionStatus`. Try `ATAT1` vs `ATAT2`, and `010C1` vs `010C`, and keep the fastest stable combination.
2. **Stationary check (safe).** Set a low threshold (for example 3000). In Park or Neutral, rev gently and watch when the flash fires compared with the tachometer. Free revving rises much faster than driving in gear, so treat this only as a sanity check.
3. **Driving check (passenger watching).** On an empty road, in M mode, use gentle pulls in 1st–3rd gear. The passenger compares the flash moment with the tachometer and adjusts `leadMs` in the advanced settings:
   - Light **too late** → increase `leadMs`.
   - Light **too early** → decrease it.
4. **Choose the real threshold below the transmission's own auto-upshift point.** Many automatics shift by themselves near the redline even in M mode.

**Done when:** the flash is consistently within about 100–200 RPM of the threshold across gears.

**Safety:**

- The driver never touches the phone while moving.
- The phone is mounted.
- Follow local traffic laws.

---

### Phase 9 — Later (optional)

- **Android build:** `npx expo run:android` (needs Android Studio). BLE permissions on Android 12+ are handled by the ble-plx config plugin. Test the adapter in BLE mode.
- **Per-car profiles:** read the VIN (`0902`) and remember a threshold and `leadMs` per car.
- **Per-gear thresholds,** if a gear PID is available for a specific car.
- **Record and replay:** a transport that saves a raw in-car session and replays it at home, very useful once you test on many cars.
- **TestFlight** distribution to friends' phones (requires the paid Apple Developer Program).

---

## 7. Safety rules (non-negotiable)

1. **Read-only.** The `Elm327` driver only sends commands on its allowlist:
   - AT commands: `ATZ`, `ATWS`, `ATI`, `ATE0`, `ATE1`, `ATL0`, `ATL1`, `ATS0`, `ATS1`, `ATH0`, `ATH1`, `ATSP0`, `ATAT0`, `ATAT1`, `ATAT2`, `ATST..` (timeout), `ATRV` (battery voltage), `ATDPN` (protocol number).
   - OBD requests: mode `01` (`01XX` with an optional trailing count digit) and mode `09` (`09XX`).
   - **Everything else is rejected before sending**, including `04` (clear codes), any `2E` / `2F` / `31` / `27` (writes, actuator tests, routines, security access), and `ATPP*` (writes the adapter's own settings memory).
2. **Fail safe.** On stale data, errors or disconnects, the light is OFF and the UI shows "NO DATA" clearly.
3. **Flash at 3 Hz or slower** (photosensitivity guideline).
4. **Never interact with the phone while driving.**

---

## 8. Troubleshooting quick reference

| Symptom                                      | Likely cause / fix                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run emu:smoke` can't connect            | The emulator isn't running. Start `elm -n 35000` in another terminal.                                                                      |
| Answers look cut off or merged               | Parsing before `>` arrived. Buffer until the prompt.                                                                                       |
| `STOPPED` responses                          | A new command was written while the adapter was busy. Check the queue.                                                                     |
| `SEARCHING...` then `UNABLE TO CONNECT`      | Ignition off, or a protocol issue. Turn the ignition on and retry `ATSP0` + `0100`.                                                        |
| `?` for `010C1`                              | Not supported by this adapter or emulator. The fallback to `010C` should handle it.                                                        |
| App can't reach the emulator from the iPhone | Local Network permission denied, the emulator bound to localhost only, the macOS firewall, or the devices are on different Wi-Fi networks. |
| No sound with the silent switch on           | The audio mode isn't set to play in silent mode.                                                                                           |
| Dev build stops opening after a week         | The free Apple ID signing expired. Re-run `npx expo run:ios --device`.                                                                     |
| BLE scan finds nothing                       | Bluetooth permission not granted, the adapter is not powered, or you are testing in the Simulator (not supported).                         |
