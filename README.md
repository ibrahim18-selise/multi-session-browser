# Multi-Session Browser 2 (web edition)

A tabbed browser where every tab can have its own sign-in. Open one tab as an admin, another as a customer, and switch between them without logging out. This edition is web only: the Device Lab and mobile testing from version 1 are removed.

## Download

Get the latest installers from the [Releases page](../../releases/latest).

- Windows: `Multi-Session-Browser-Setup-<version>.exe` installs the app with Start menu and desktop shortcuts and an uninstaller, no admin rights needed. `Multi-Session-Browser-<version>-portable.exe` runs without installing.
- Mac: the `arm64` .dmg is for Apple Silicon (M1 to M4), the `x64` .dmg is for Intel Macs.

The app is not code signed yet. On Windows, SmartScreen may say it "protected your PC": click "More info", then "Run anyway". On Mac, after dragging the app to Applications, run this once in Terminal if macOS says it is damaged or cannot be opened:

```
xattr -cr "/Applications/Multi-Session Browser.app"
```

If it still will not open, also run `codesign --force --deep --sign - "/Applications/Multi-Session Browser.app"`.

## What it does

- Each tab gets its own cookies, storage and cache, so one window can hold several logged-in roles on the same site.
- Tabs can also share a sign-in. Pick "Same as ..." when opening a tab, use "Duplicate (same sign-in)", or open a link in a new tab. Shared tabs show a link badge with the number of tabs in that session.
- Name and color every tab. The color runs across the toolbar so you always know which role you are acting as.
- Sessions survive restarts. Close the app, reopen it, and you are still signed in.
- Workspaces save a set of tabs with their sign-ins and reopen them in one click.
- Export a workspace to a file and send it to a colleague. The file holds tab names, colors and addresses only (query strings removed). No cookies, passwords or tokens leave your computer. They import it and sign in once per tab.
- Developer tools per tab (F12 on Windows, Alt+Cmd+I on Mac), plus "Inspect element" on right click.
- "Sign out of every site in this session" wipes one session without touching the others.
- Site permission requests (camera, microphone, location, notifications) are asked per session instead of granted silently.

## Keyboard shortcuts

Ctrl is Cmd on Mac.

- Ctrl+T new tab, Ctrl+W close tab, Ctrl+Shift+D duplicate with the same sign-in
- Ctrl+L address bar, Ctrl+R reload, Ctrl+Shift+R reload without cache
- Ctrl+Tab and Ctrl+Shift+Tab switch tabs, Ctrl+1 to Ctrl+8 jump to a tab, Ctrl+9 last tab
- Ctrl+Shift+S workspaces
- Ctrl+= and Ctrl+- zoom, Ctrl+0 actual size
- Double-click a tab to rename or recolor it, middle-click to close, drag to reorder

## Building and releasing

Every tag that starts with `v` builds the Windows installer, the portable exe and both Mac disk images on GitHub Actions and attaches them to a release.

1. Change `version` in `package.json` (for example to 2.0.1) and commit.
2. Tag and push: `git tag v2.0.1 && git push origin v2.0.1`.
3. The files appear on the Releases page after about 15 minutes.

To run from source: `npm install`, then `npm start`. To build locally: `npm run dist:win` on Windows or `npm run dist:mac` on a Mac.

## Where data lives

Sessions, tabs and workspaces are stored in the app's user data folder (`%APPDATA%\Multi-Session Browser` on Windows, `~/Library/Application Support/Multi-Session Browser` on Mac). Deleting that folder resets the app.

## Known limits

- Some Google sign-in pages refuse embedded browsers. The app presents itself as standard Chrome, which works for most sites, but if a provider still blocks it, sign in through that provider's own page.
- Code signing (to remove the SmartScreen and Gatekeeper warnings) needs a paid certificate. The build config is ready for it once you have one.
