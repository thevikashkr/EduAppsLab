# EduRecScreen

A Windows desktop screen-recording app built with Electron. It can record up to
four selected displays, mix in system audio and a microphone, and composite a
camera preview into the saved video as a circular, high-resolution inset. Drag
across the live preview to record a specific screen area; the preview itself is
never saved. Recording continues when the app is minimized. A recording
watermark and elapsed timer are included in the video, and the app title/taskbar
indicates when recording is active.
Screen access is granted only for displays selected in the app, and microphone
and camera access is requested only when recording starts.

## Run locally

Install Node.js 20.19 or later, then run:

```bash
npm install
npm start
```

Run the screen-capture permission tests with:

```bash
npm test
```

## Build the Windows installer

```bash
npm run dist:win
```

The Windows NSIS installer is written to `release/`. The package can be built
on Windows or Linux; a Windows code-signing certificate is not included.

## Trial and billing prototype

Registration creates a local account with a 30-day trial. Trial recordings
stop after five minutes and use 720p output; the trial supports up to four
screens. The $10/month EduRecScreen Plus plan is presented as a preview, with
up-to-4K output and a higher recording bitrate. Payment processing and
real server-backed authentication are not connected.

Accounts, recording metadata, and the trial status are stored locally in the
app. Recordings are downloaded to the user's Downloads folder and are never
uploaded. MP4 is used when the system's MediaRecorder supports it; otherwise,
recordings use WebM with VP9/VP8 and Opus when audio is enabled. This prototype
does not store passwords in plain text, but its local accounts are not a
substitute for production authentication.
