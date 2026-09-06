Signal Desktop -> Local backend bridges

This project includes a small notification bridge for Linux and notes about alternative approaches.

1) Quick Linux bridge (notifications)
- Path: tools/notify-bridge.js
- Purpose: listens to desktop notifications via D-Bus and forwards Signal Desktop messages to the local backend
- Pros: quick to set up, no extra Signal registration
- Cons: depends on Signal Desktop showing notifications (muted notifications will not be captured), sender name in notifications may be a display name (not phone number)

Requirements:
- Node.js (v16+ recommended)
- npm install dbus-next node-fetch

Install and run:
  cd /path/to/project
  npm install dbus-next node-fetch
  node tools/notify-bridge.js

If you want it to run automatically on login, create a systemd user service (example below) or add the command to your desktop's autostart.

systemd user unit example (~/.config/systemd/user/signal-notify-bridge.service):

[Unit]
Description=Signal notification bridge (for forwarding Signal Desktop notifications to local backend)
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/env node /path/to/project/tools/notify-bridge.js
Restart=on-failure

[Install]
WantedBy=default.target

Enable and start:
  systemctl --user enable --now signal-notify-bridge.service

2) More robust option: signal-cli REST API
- signal-cli is an unofficial Signal client that can be run as a headless client and paired/linked with an existing account or use a dedicated number.
- There are REST wrappers (signal-cli-rest-api) which expose an HTTP endpoint for sending/receiving messages, which you can then forward to the dashboard backend.
- Pros: reliable ingestion of messages, control over message content
- Cons: more setup, may require linking/registering a Signal number or device

3) Cross-platform notes
- macOS: can capture notifications using AppleScript or a small Objective-C/Python wrapper (NSUserNotificationCenter notifications). A simple approach is to run an AppleScript that polls notifications or uses a third-party tool like terminal-notifier to forward events.
- Windows: capturing Toast notifications requires WinRT; a simpler approach is to use a small automation utility (AutoHotkey) or to use signal-cli instead.

Manual entry
- The project UI includes a test form for manual submissions. Use it to verify parsing and aggregation before automating the bridge.

Starting the dashboard
- Default port: `3000`
- Custom port: `node server.js -port 3005`
- You can also use `--port 3005`
- If `-port` is omitted, the server uses the default port.

Mapping sender identity
- The notification bridge forwards the display name from notifications. Update data/config.json to add displayName entries for allowedSenders, or use displayName instead of phone numbers in allowedSenders. The backend matches the posted "sender" value to config.allowedSenders.signalUser currently — you can add a "displayName" field and modify server.js to match either.

Next steps
- If you want, update server.js to accept matches by displayName as well as signalUser. I can update the server code and config for that, and provide a packaged instruction to run the bridge as a systemd --user service.