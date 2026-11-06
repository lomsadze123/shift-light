# Running shift-light on the iPhone

A step-by-step guide for getting back to a running app after the Mac was turned off.

The app is a **development build** (`expo-dev-client`), not Expo Go. Expo Go cannot run it any more, because the app uses native modules (TCP sockets, Bluetooth).

Two pieces work together:

- **The app on the iPhone** (the native "shell"). You build it with Xcode tools and install it over USB. You only rebuild it when native things change.
- **Metro**, the JavaScript server on the Mac (`npx expo start`). The dev build downloads your TypeScript code from Metro over Wi-Fi each time it opens. Most code changes need only Metro, with no rebuild.

---

## Step 0 — Which path do I need?

| Situation                                                                    | What to do                        |
| ---------------------------------------------------------------------------- | --------------------------------- |
| I only changed TypeScript/TSX code, and the app still opens on the phone     | **Part B** (daily start)          |
| `app.json` changed (plugins, permissions, bundle id, icon)                   | **Part A** (full rebuild), then C |
| A native package was added or removed (`npx expo install …` of a native lib) | **Part A** (full rebuild), then C |
| More than **7 days** since the last install (free Apple ID signing expired)  | **Part A** from step A3, then C   |
| The app was deleted from the phone, or it opens and closes immediately       | **Part A** from step A3, then C   |
| iOS on the phone or Xcode on the Mac was updated                             | **Part A** from step A3, then C   |
| I want to use the app in the car **without the Mac**                         | **Part D** (Release build)        |

> **Right now (Phase 7):** `app.json` gained the `react-native-ble-plx` Bluetooth plugin, but the native `ios/` folder was generated before that. **Do the full Part A** (including A2) the next time you start.

---

## Part 0 — Power-on checklist (every time)

1. Turn on the Mac and log in.
2. Make sure the **Mac and the iPhone are on the same Wi-Fi network**. Metro and the emulator are reached over Wi-Fi.
3. Unlock the iPhone.
4. Connect the iPhone to the Mac with the **USB cable** (needed for Part A; harmless otherwise).
5. If the iPhone asks **"Trust This Computer?"**, tap **Trust** and enter the passcode.
6. Check **Developer Mode** is still on: iPhone **Settings → Privacy & Security → Developer Mode** (at the bottom). If it is off, turn it on; the phone restarts and asks you to confirm.
7. Open the project in VS Code:
   ```
   cd ~/Work/FOSS/CAR/shift-light
   code .
   ```
8. Open a terminal in VS Code (**Terminal → New Terminal**). All commands below run from the project folder.

You do **not** need to open Xcode for a normal start. The `npx expo` commands call Xcode's build tools for you. Xcode is only needed for the cases described in A5 and A6.

---

## Part A — Rebuild and install the dev build (USB)

### A1. Install npm packages (only if needed)

Only if `package.json` / `package-lock.json` changed, or `node_modules` is missing:

```
npm install
```

### A2. Regenerate the native iOS project (only when native config changed)

Only when `app.json` changed or a native package was added/removed:

```
npx expo prebuild --platform ios
```

What it does: deletes and recreates the `ios/` folder from `app.json` and the config plugins, then runs `pod install`. The `ios/` folder is generated and ignored by git, so this is safe. It does wipe any setting you made by hand in Xcode (for example the signing team, see A5).

### A3. Build and install on the iPhone

```
npx expo run:ios --device
```

1. A list of devices appears. Pick **your iPhone** (not a Simulator) with the arrow keys and press Enter.
2. If it asks for a **development team**, pick your personal team (your Apple ID).
3. Wait. The first build takes several minutes; later ones are faster.
4. When it finishes, the app is installed and opens on the phone. **Metro starts automatically in the same terminal**, so you can skip B1.

Keep that terminal open. It is now your Metro terminal.

### A4. The phone says "Untrusted Developer"

If the app icon appears but tapping it shows "Untrusted Developer":

1. iPhone **Settings → General → VPN & Device Management**.
2. Under "Developer App", tap **Apple Development: <your Apple ID>**.
3. Tap **Trust** and confirm.
4. Open the app again.

### A5. Signing error ("Signing for shiftlight requires a development team")

1. Open the workspace in Xcode (the `.xcworkspace`, **not** the `.xcodeproj`):
   ```
   open ios/shiftlight.xcworkspace
   ```
2. In the left sidebar, click the blue **shiftlight** project, then the **shiftlight** target.
3. Open the **Signing & Capabilities** tab.
4. Tick **Automatically manage signing**.
5. **Team:** choose **<your name> (Personal Team)**. If it is not in the list: **Xcode → Settings → Accounts → +** and sign in with your Apple ID.
6. Wait until the "Signing Certificate" line shows no error.
7. Close Xcode and run A3 again.

You have to repeat this after every A2, because A2 recreates `ios/`.

### A6. Other reasons to open Xcode

- **Is the phone detected?** Xcode → **Window → Devices and Simulators**. The iPhone should be listed without warnings.
- **After an iOS update**, Xcode may show "Preparing device…" / "Copying shared cache symbols" in that window. Wait until it finishes, then run A3.
- A build fails and the terminal error is unclear. Build from Xcode (select the iPhone at the top, press ▶) to see the full error.

---

## Part B — Daily start (no rebuild)

### B1. Start Metro

In terminal 1 (skip this if you just ran A3, which already started Metro):

```
npx expo start
```

Leave it running. It prints a QR code and the server address.

### B2. Open the app on the iPhone

1. Open the **shift-light** app on the phone (**not** Expo Go).
2. The dev launcher shows **Development servers** with an entry like `http://192.168.x.x:8081`. Tap it.
   - Not listed? Scan the QR code from the terminal with the iPhone **Camera** app, or type the URL by hand ("Enter URL manually").
3. The JavaScript bundle downloads (progress bar on first open), then the shift-light screen appears.

### B3. While you work

- Saving a file reloads the app automatically (**Fast Refresh**).
- Full reload: press **`r`** in the Metro terminal, or **shake the phone** → **Reload**.
- Dev menu (reload, performance monitor, go home): **shake the phone**, or press **`m`** in the Metro terminal.

---

## Part C — Choose a data source in the app

Choose the source at the top of the screen (Mock / TCP / BLE), then tap **Connect**.

### C1. Mock (fake car)

Nothing to set up. Select **Mock**, tap **Connect**.

### C2. TCP — the ELM327 emulator on the Mac (at home)

1. Open a **second terminal** (VS Code: the **+** in the terminal panel) and start the emulator so it listens on all network interfaces:
   ```
   elm -n 35000 -i 0.0.0.0
   ```
   Leave it running. It shows a `CMD>` prompt.
2. Open a **third terminal** and get the Mac's Wi-Fi IP address:
   ```
   ipconfig getifaddr en0
   ```
   Example output: `192.168.1.23`. (Empty output means you are not on Wi-Fi via `en0`; try `ipconfig getifaddr en1`.)
3. In the app: select **TCP**, enter that IP as **host**, keep port **35000**.
4. Tap **Connect**.
5. The first time, iOS asks to **find devices on your local network**. Tap **Allow**.
6. RPM from the emulator should appear. The Debug panel shows the raw traffic.

The Mac's IP can change after a restart or on another Wi-Fi. If Connect fails, repeat step 2 and update the host.

### C3. BLE — the real vLinker MC+ adapter (in the car)

1. Car **parked**. Plug the vLinker MC+ into the OBD-II port (under the dashboard, driver side).
2. Ignition **on** (engine **running** for real RPM). The adapter LED should light up.
3. On the phone: Bluetooth **on**. Close other OBD apps (for example Car Scanner); the adapter accepts only one connection.
4. In the app: select **BLE**, scan, and pick the adapter (names with `vLinker`, `OBD` or `ELM` are listed first).
5. Tap **Connect**. The first time, iOS asks for **Bluetooth** access. Tap **Allow**.
6. Compare the app's RPM with the dashboard tachometer.

**Important:** a dev build still loads its code from Metro on the Mac. In the car this only works if the Mac is with you, running `npx expo start`, on the **same network as the phone** (for example both on the phone's Personal Hotspot). Without the Mac, use **Part D**.

Safety: a passenger operates the phone. The driver never touches it while moving.

---

## Part D — Standalone build for the car (no Mac needed)

A Release build puts the JavaScript inside the app, so it runs without Metro.

1. Connect the iPhone by USB (Part 0).
2. Run:
   ```
   npx expo run:ios --device --configuration Release
   ```
3. Pick your iPhone and wait for the build. The app installs and opens.

Differences from the dev build:

- No Metro, no dev menu, no Fast Refresh. **Every code change needs this build again.**
- It still **expires after 7 days** (free Apple ID).
- It replaces the dev build on the phone (same app). To go back to development, run `npx expo run:ios --device` (without `--configuration`).

---

## Part E — Shutting down

1. In the app, tap **Disconnect**.
2. In the emulator terminal: type `quit` and press Enter, or press **Ctrl+C**.
3. In the Metro terminal: press **Ctrl+C**.
4. In the car: **unplug the adapter** when you are done (security, and it drains the battery slowly).
5. Unplug the iPhone.

---

## Troubleshooting

| Symptom                                                                    | Fix                                                                                                                                                                        |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev launcher shows **no development servers**                              | Is `npx expo start` running? Are the Mac and phone on the same Wi-Fi? Scan the QR code or enter `http://<mac-ip>:8081` manually.                                           |
| "Could not connect to development server"                                  | Same as above. Also check the macOS firewall (**System Settings → Network → Firewall**) allows `node`, and allow **Local Network** for shift-light on the phone.           |
| "Port 8081 is being used by another process"                               | An old Metro is still running. Close other terminals running `expo start`, or run `lsof -i :8081` and stop that process.                                                   |
| `run:ios` does not list the iPhone                                         | Unlock the phone, tap **Trust**, try another cable/port, check **Developer Mode** is on, and look in Xcode → **Window → Devices and Simulators**.                          |
| "Signing … requires a development team"                                    | Part A5.                                                                                                                                                                   |
| "Untrusted Developer" when opening the app                                 | Part A4.                                                                                                                                                                   |
| The app opened fine last week, now closes immediately / "Unable to verify" | Free signing expired after 7 days. Run Part A from A3.                                                                                                                     |
| CocoaPods / "pod install" / missing native module errors                   | Run A2 (`npx expo prebuild --platform ios`), then A3. Red screen "native module … not found" usually means the app needs a rebuild.                                        |
| TCP **Connect** fails                                                      | Emulator running with `-i 0.0.0.0`? Correct IP (C2 step 2)? Port 35000? **Settings → Privacy & Security → Local Network → shift-light** is on? Same Wi-Fi? macOS firewall? |
| BLE scan finds nothing                                                     | **Settings → shift-light → Bluetooth** is allowed? Adapter LED on (ignition on)? Another app connected to it? BLE does not work in the iOS Simulator.                      |
| App shows **NO DATA**                                                      | Expected fail-safe: data is stale, there was an error, or the connection dropped. The light stays off. Check the Debug panel, then Disconnect and Connect again.           |

---

## Cheat sheet

```
# Daily (only TS changes):
npx expo start                                  # then open shift-light app on phone, tap the server

# Native change / 7 days passed / app deleted (USB connected):
npx expo prebuild --platform ios                # only if app.json or native packages changed
npx expo run:ios --device                       # pick the iPhone

# Emulator for TCP testing:
elm -n 35000 -i 0.0.0.0                         # terminal 2
ipconfig getifaddr en0                          # IP to type into the app (port 35000)

# Car without the Mac:
npx expo run:ios --device --configuration Release
```
