# EduRecScreen

EduRecScreen is a Windows desktop screen recorder built with Electron and the
Web Media APIs. It provides live previews, multi-display capture, optional
audio and camera inputs, a recording region selector, automatic recording
limits, a local recording library, and a 30-day local trial.

## Features

- Capture one to four selected displays at once.
- Preview selected screens before and during recording.
- Drag a region on the preview canvas to record only that area.
- Mix desktop/system audio and microphone audio.
- Add a camera preview as a circular, high-resolution inset.
- Add an elapsed timer and recording watermark to the saved canvas.
- Choose an automatic stop time or stop recording manually.
- Save recordings to the Downloads folder as MP4 when supported, with WebM as
  the fallback format.
- Keep local metadata for previously saved recordings.
- Restrict display capture to displays explicitly selected in the app.
- Indicate active recording in the app title and Windows taskbar.

## Requirements

- Windows for the full desktop, system-audio, and installer experience.
- Node.js 20.19 or later.
- npm.
- Microphone, camera, and display-recording permissions where requested.

System audio loopback is enabled only on Windows.

## Run from source

```bash
cd screen-recorder
npm install
npm start
```

On first launch, create a local trial account or log in to an existing local
account. Select one or more displays, optionally enable microphone, system
audio, and camera inputs, then start recording.

## Recording controls

1. Select **Select screens** and choose up to four displays.
2. Review the live preview.
3. Choose **Select area** and drag over the preview to limit the recording to
   that region, or leave the selection at full screen.
4. Optionally enable the microphone, system audio, and camera.
5. Select an auto-stop interval or leave it set to **Off**.
6. Select **Start recording**, then **Stop & save** when finished.

The app records a composed canvas rather than saving the raw browser preview.
Screen streams, microphone and system audio, camera overlay, timer, watermark,
and selected crop are composed into the output.

## Trial and billing prototype

New accounts receive a 30-day local trial. Trial accounts can record:

- Up to five minutes per recording.
- Up to 720p output.
- Up to four displays.

The app also presents an EduRecScreen Plus option described as:

- Unlimited recording time.
- Up to 4K output.
- Up to four displays.
- A 28 Mbps video output target.

Subscription billing is not implemented. Selecting **Get full access** does not
take payment or change the local account plan.

## Local data and privacy

EduRecScreen stores account details, password salts and SHA-256 password hashes,
the active account email, and recording metadata in browser `localStorage`.
This is a local application prototype, not a server-backed authentication or
payment system. Password hashes are not plain text passwords, but local
accounts should not be treated as production authentication.

Recordings are downloaded directly to the user's Downloads folder. The app does
not upload recordings or recording metadata. Its download handler verifies that
the save request is a recognized local EduRecScreen recording before selecting
the destination.

## Architecture

- `main.cjs` creates the Electron window and manages IPC, downloads, app menus,
  and Windows recording state.
- `preload.cjs` exposes a small context-isolated API to the renderer.
- `capture-permissions.cjs` enforces display-capture and media permission rules.
- `renderer.js` implements the UI, local accounts, previews, canvas composition,
  MediaRecorder output, and recording library.
- `index.html` and `styles.css` define the application interface.
- `capture-permissions.test.cjs` contains Node tests for capture permissions.

## Tests

Run the screen-capture permission test suite:

```bash
npm test
```

The tests cover the app main frame, trusted origins, display selection,
unavailable displays, Windows loopback audio, and rejection of unselected or
foreign capture requests.

## Build the Windows installer

```bash
npm run dist:win
```

The NSIS installer is written to `screen-recorder/release/`. The package can be
assembled on Windows or Linux, but the repository does not include a Windows
code-signing certificate.

## Package scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the Electron app locally |
| `npm test` | Run the Node capture-permission tests |
| `npm run dist:win` | Build the Windows NSIS installer |
