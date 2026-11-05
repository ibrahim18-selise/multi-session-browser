# Multi-Session Browser 2 (web edition)

A tabbed browser where every tab can have its own sign-in. Open one tab as an admin, another as a customer, and switch between them without logging out. This edition is web only: the Device Lab and mobile testing from version 1 are removed.

## Download

All files are on the [latest release](../../releases/latest).

| File | For |
|---|---|
| `Multi-Session-Browser-Setup-win-x64.exe` | Windows 10 and 11, 64-bit. Installs with Start menu and desktop shortcuts. |
| `Multi-Session-Browser-portable-win-x64.exe` | Windows 10 and 11, 64-bit. Runs without installing. |
| `Multi-Session-Browser-Setup-win7.exe` | Windows 7 SP1 and 8.1, and any 32-bit Windows. Picks 32 or 64-bit itself. |
| `Multi-Session-Browser-mac-arm64.dmg` | Macs with Apple Silicon (M1, M2, M3, M4). macOS 11 or newer. |
| `Multi-Session-Browser-mac-x64.dmg` | Macs with an Intel processor. macOS 11 or newer. |

None of these need admin rights. The app is not code signed yet: if you download in a browser, Windows SmartScreen may say it "protected your PC" (click "More info", then "Run anyway"), and macOS may refuse to open it. Installing from a terminal, below, avoids both.

## Install from a terminal

### Windows (7, 8.1, 10 and 11)

Open **Command Prompt** (Start, type `cmd`, press Enter) and paste one command. Each one downloads the file, installs it silently and opens the app.

Detects your Windows version and picks the right installer:

```
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=3072; iex ((New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/ibrahim18-selise/multi-session-browser/main/install/install-windows.ps1'))"
```

Windows 7, 8.1 or 32-bit installer (`Multi-Session-Browser-Setup-win7.exe`):

```
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:MSB_WIN7='1'; [Net.ServicePointManager]::SecurityProtocol=3072; iex ((New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/ibrahim18-selise/multi-session-browser/main/install/install-windows.ps1'))"
```

Windows 10 and 11 installer (`Multi-Session-Browser-Setup-win-x64.exe`), using the `curl` built into Windows 10 and 11:

```
curl -fL -o "%TEMP%\msb-setup.exe" https://github.com/ibrahim18-selise/multi-session-browser/releases/latest/download/Multi-Session-Browser-Setup-win-x64.exe && "%TEMP%\msb-setup.exe" /S
```

Windows 10 and 11 portable (`Multi-Session-Browser-portable-win-x64.exe`), saved to your Desktop and opened:

```
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:MSB_PORTABLE='1'; [Net.ServicePointManager]::SecurityProtocol=3072; iex ((New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/ibrahim18-selise/multi-session-browser/main/install/install-windows.ps1'))"
```

Windows 7 note: GitHub only accepts TLS 1.2 connections. If the command says TLS 1.2 is not available, install Windows 7 SP1, .NET Framework 4.8 and Windows Management Framework 5.1 from Microsoft, then run it again.

These commands are for Command Prompt. If you are already in PowerShell, type `cmd` and press Enter first.

### Mac (M series and Intel)

Open **Terminal** (Applications, Utilities, Terminal) and paste one command. Each one downloads the disk image, copies the app to Applications and prepares it to open.

Detects your Mac's processor and picks the right build:

```
curl -fsSL https://raw.githubusercontent.com/ibrahim18-selise/multi-session-browser/main/install/install-mac.sh | bash
```

Apple Silicon, M1 to M4 (`Multi-Session-Browser-mac-arm64.dmg`):

```
curl -fsSL https://raw.githubusercontent.com/ibrahim18-selise/multi-session-browser/main/install/install-mac.sh | MSB_ARCH=arm64 bash
```

Intel (`Multi-Session-Browser-mac-x64.dmg`):

```
curl -fsSL https://raw.githubusercontent.com/ibrahim18-selise/multi-session-browser/main/install/install-mac.sh | MSB_ARCH=x64 bash
```

Not sure which Mac you have? Apple menu, About This Mac: "Chip: Apple M..." means Apple Silicon, "Processor: Intel" means Intel. The first command works it out for you.

### Installing a specific version

Every command above installs the latest release. To install an older one, set the version first. On Windows add `$env:MSB_VERSION='2.0.1'; ` right after `-Command "`. On a Mac put `MSB_VERSION=2.0.1` before `bash`.

### Uninstalling

Windows: Settings, Apps, Multi-Session Browser, Uninstall. Or in Command Prompt:

```
"%LOCALAPPDATA%\Programs\Multi-Session Browser\Uninstall Multi-Session Browser.exe" /S
```

Mac:

```
rm -rf "/Applications/Multi-Session Browser.app"
```

## What it does

### Tabs with separate sign-ins
- Each tab gets its own cookies, storage and cache, so one window can hold several logged-in roles on the same site.
- Tabs can also share a sign-in. Pick "Same as ..." when opening a tab, use "Duplicate (same sign-in)", or open a link in a new tab. Shared tabs show a link badge with the number of tabs in that session.
- Name and color every tab. The color runs across the toolbar so you always know which role you are acting as.
- Sessions survive restarts, and workspaces reopen a whole set of tabs with their sign-ins in one click. Export a workspace to share it: the file holds tab names, colors and addresses only, never cookies or passwords.

### New tab page and search
- A new tab opens a search page instead of a blank screen. Type a question to search, or an address to go there.
- It shows your bookmarks and the sites you visit most.
- Pick the search engine (Google, Bing, DuckDuckGo or Brave Search) in the menu, under Search engine.

### Suggestions from sites you have visited
- As you type in the address bar or the new tab search, the browser suggests pages from your history and bookmarks, and completes addresses you have typed before.
- Use the arrow keys to pick a suggestion. Shift+Delete removes a highlighted history entry.
- The History panel lists everything you have visited, with search and "Clear browsing history".

### Saved passwords with Touch ID or Windows Hello
- When you sign in to a site, the browser offers to save the password. You can edit the username before saving, or choose "Never for this site".
- On your next visit it offers to fill the sign-in form. You confirm with:
  - **Touch ID** on Macs that have it,
  - **Windows Hello** on Windows 10 and 11 (fingerprint, face or Windows Hello PIN, whichever the PC has set up),
  - an **app PIN** on Windows 7, 8.1 and Macs without Touch ID. You create it the first time you save a password.
- Passwords are encrypted with the computer's own key store (Keychain on Mac, DPAPI on Windows), so they only work on that computer for that user account. They are never included in exported workspaces.
- If a site has more than one saved account (an admin and a customer, say), pick the account before filling.
- The Passwords panel shows every saved sign-in. Showing or copying a password asks for Touch ID, Windows Hello or your PIN first, and a copied password is cleared from the clipboard after 30 seconds.

### Screenshots you can mark up
- Click the camera in the toolbar (or press Ctrl+Shift+X) to capture the current page.
- Draw with a pen, highlight, add arrows, boxes and text, in seven colors and three sizes. Ctrl+Z undoes.
- Then copy the image, save it as a PNG file, or add it to your Clipboard.

### Clipboard for notes and screenshots
- The Clipboard panel keeps notes and screenshots for later, right next to the page.
- Write a note, add what is on your computer clipboard, or take a screenshot from the panel.
- Each item can be copied, saved as a file, edited (notes) or marked up again (screenshots). Everything stays on your computer.

### Bookmarks
- Click the star in the address bar or press Ctrl+D to bookmark a page. Click it again to remove it.
- Bookmarks appear on the bookmarks bar (Ctrl+Shift+B shows or hides it), on the new tab page and in the Bookmarks panel, where you can search, rename and delete them. Drag them on the bar to reorder.

### Look and feel
- Four themes from Claude's theme set: Arctic Frost (light) and Ocean Depths (dark) by default, following your computer's light or dark setting, plus Modern Minimalist and Midnight Galaxy. Change it in the menu, under Appearance.
- Developer tools per tab (F12 on Windows, Alt+Cmd+I on Mac), plus "Inspect element" on right click.
- Site permission requests (camera, microphone, location, notifications) are asked per session instead of granted silently.

## Keyboard shortcuts

Ctrl is Cmd on Mac.

- Ctrl+T new tab, Ctrl+W close tab, Ctrl+Shift+D duplicate with the same sign-in
- Ctrl+L address bar, Ctrl+R reload, Ctrl+Shift+R reload without cache
- Ctrl+Tab and Ctrl+Shift+Tab switch tabs, Ctrl+1 to Ctrl+8 jump to a tab, Ctrl+9 last tab
- Ctrl+D bookmark this page, Ctrl+Shift+B bookmarks bar, Ctrl+Shift+O bookmarks panel
- Ctrl+H history (Cmd+Y on Mac), Ctrl+Shift+Y clipboard, Ctrl+Shift+X screenshot
- Ctrl+Shift+S workspaces
- Ctrl+= and Ctrl+- zoom, Ctrl+0 actual size
- Double-click a tab to rename or recolor it, middle-click to close, drag to reorder

## Building and releasing

Every tag that starts with `v` builds all the files above on GitHub Actions and attaches them to a release. The Windows 7 build uses Electron 22, the last version that runs on Windows 7 and 8.1. Everything else uses Electron 33.

1. Change `version` in `package.json` and commit.
2. Tag and push: `git tag v2.0.2 && git push origin v2.0.2`.
3. The files appear on the release after about 15 minutes.

To run from source: `npm install`, then `npm start`.

## Where data lives

Sessions, tabs, workspaces, bookmarks, history, Clipboard items and encrypted passwords are stored in the app's user data folder (`%APPDATA%\Multi-Session Browser` on Windows, `~/Library/Application Support/Multi-Session Browser` on Mac). Deleting that folder resets the app.

## Known limits

- The Windows 7 build runs on an older Chromium (108) that no longer gets security updates. Use it only where Windows 10 or 11 is not an option.
- Some Google sign-in pages refuse embedded browsers. If a provider blocks sign-in, sign in through that provider's own page.
- Code signing, to remove the SmartScreen and Gatekeeper warnings, needs a paid certificate.
