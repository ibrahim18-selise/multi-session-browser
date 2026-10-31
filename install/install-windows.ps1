# Installs Multi-Session Browser on Windows 7, 8.1, 10 and 11.
# Picks the right build automatically: 64-bit Windows 10 and 11 get the
# current build, Windows 7, 8.1 and 32-bit Windows get the Windows 7 build.
#
# Run in Command Prompt or PowerShell (works on Windows 7 and later):
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=3072; iex ((New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/ibrahim18-selise/multi-session-browser/main/install/install-windows.ps1'))"
#
# Options (set in the same PowerShell session before running):
#   $env:MSB_PORTABLE = '1'       download the portable exe to the Desktop instead of installing
#   $env:MSB_VERSION = '2.0.1'    install a specific version instead of the latest
#   $env:MSB_WIN7 = '1'           force the Windows 7 build

# Everything runs inside a script block so nothing leaks into your PowerShell session.
& {
    $ErrorActionPreference = 'Stop'
    $repo = 'ibrahim18-selise/multi-session-browser'

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
    } catch {
        Write-Host 'This PC cannot use TLS 1.2, which GitHub requires.' -ForegroundColor Red
        Write-Host 'On Windows 7, install .NET Framework 4.8 and Windows Management Framework 5.1, then run this again.'
        return
    }

    $os = [Environment]::OSVersion.Version
    $is64 = ($env:PROCESSOR_ARCHITECTURE -eq 'AMD64') -or ($env:PROCESSOR_ARCHITEW6432 -eq 'AMD64') -or ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64')
    $legacy = ($os.Major -lt 10) -or (-not $is64) -or ($env:MSB_WIN7 -eq '1')
    $portable = ($env:MSB_PORTABLE -eq '1')
    $version = $env:MSB_VERSION

    if ($legacy) {
        if ($portable) { Write-Host 'The portable exe needs 64-bit Windows 10 or 11, so the Windows 7 installer will be used.' }
        $portable = $false
        $file = 'Multi-Session-Browser-Setup-win7.exe'
        $pinned = "Multi-Session-Browser-Setup-$version-win7.exe"
        $label = 'Windows 7, 8.1 and 32-bit Windows'
    } elseif ($portable) {
        $file = 'Multi-Session-Browser-portable-win-x64.exe'
        $pinned = "Multi-Session-Browser-$version-portable.exe"
        $label = 'Windows 10 and 11 (portable)'
    } else {
        $file = 'Multi-Session-Browser-Setup-win-x64.exe'
        $pinned = "Multi-Session-Browser-Setup-$version.exe"
        $label = 'Windows 10 and 11'
    }

    if ($version) {
        $url = "https://github.com/$repo/releases/download/v$version/$pinned"
    } else {
        $url = "https://github.com/$repo/releases/latest/download/$file"
    }

    if ($portable) {
        $out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Multi-Session Browser.exe'
    } else {
        $out = Join-Path $env:TEMP $file
    }

    Write-Host "Downloading Multi-Session Browser for $label (about 80 to 130 MB)"
    try {
        (New-Object Net.WebClient).DownloadFile($url, $out)
    } catch {
        Write-Host "Download failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "You can download it in a browser instead: https://github.com/$repo/releases/latest"
        return
    }

    if ($portable) {
        Write-Host "Saved to $out"
        Start-Process -FilePath $out
        return
    }

    Get-Process -Name 'Multi-Session Browser' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    Write-Host 'Installing'
    $p = Start-Process -FilePath $out -ArgumentList '/S' -Wait -PassThru
    Remove-Item $out -Force -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0) {
        Write-Host "The installer stopped with code $($p.ExitCode)." -ForegroundColor Red
        return
    }

    Write-Host 'Installed. It is in the Start menu and on the Desktop.' -ForegroundColor Green
    foreach ($dir in @('Multi-Session Browser', 'multi-session-browser')) {
        $exe = Join-Path $env:LOCALAPPDATA "Programs\$dir\Multi-Session Browser.exe"
        if (Test-Path $exe) { Start-Process -FilePath $exe; break }
    }
}
