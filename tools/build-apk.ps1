<#
  Builds the app and (optionally) installs it. Made to REUSE work instead of repeating it:
    * keeps the Gradle daemon alive between runs (no JVM warm-up each time) and uses the Gradle build cache,
    * never cleans: C++ objects (.cxx), Kotlin/Java classes and the Metro JS cache are reused, so a code-only change rebuilds in minutes,
    * builds ONE CPU type per target (phone = arm64, emulator = x86_64), each with its own cache, and saves each APK in dist/,
    * checks Windows memory first (a full "commit limit" is what made earlier builds die with clang 0x5AA) and can free it.

  Usage (PowerShell, from the project folder):
    .\tools\build-apk.ps1 -Target phone -Install          # build for the real phone and install it
    .\tools\build-apk.ps1 -Target emulator -Install       # build for the emulator (starts it if needed) and install
    .\tools\build-apk.ps1 -Target both -Install -FreeMemory
  -FreeMemory stops the emulator (only when building for the phone) and idle Gradle daemons before building.
  Nothing here changes Windows settings or closes your own programs.
#>
param(
  [ValidateSet('phone', 'emulator', 'both')][string]$Target = 'phone',
  [switch]$Install,      # kept so old commands still work; installing is now the default
  [switch]$NoInstall,    # build only
  [switch]$CheckOnly,    # print memory + devices and stop
  [switch]$FreeMemory,
  [switch]$Qa,   # test build: screenshots allowed (the normal build always blocks them)
  [string]$Avd = 'Pixel_6'
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$android = Join-Path $project 'android'
$dist = Join-Path $project 'dist'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$emulator = Join-Path $sdk 'emulator\emulator.exe'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

function Get-FreeCommitGB {
  $m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
  [math]::Round(($m.CommitLimit - $m.CommittedBytes) / 1GB, 1)
}
function Get-Device([bool]$wantEmulator) {
  $lines = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\tdevice$' }
  foreach ($l in $lines) { $id = ($l -split "`t")[0]; if (($id -like 'emulator-*') -eq $wantEmulator) { return $id } }
  return $null
}

function Get-FreeRamGB { [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1) }
function Show-TopMemory {
  Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 4 | ForEach-Object { Write-Host ("   {0,-22} {1,6} MB" -f $_.ProcessName, [int]($_.WorkingSet64 / 1MB)) }
}
$clock = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host "Free RAM: $(Get-FreeRamGB) GB   Free commit memory: $(Get-FreeCommitGB) GB"
$phoneNow = Get-Device $false
Write-Host ("Phone: " + $(if ($phoneNow) { "connected ($phoneNow)" } else { 'NOT connected (APK will stay in dist\)' }))
if ($CheckOnly) { Write-Host 'Biggest memory users:'; Show-TopMemory; Write-Host 'CheckOnly: nothing built.'; return }
$needsMemory = ((Get-FreeCommitGB) -lt 6) -or ((Get-FreeRamGB) -lt 3)
if ($FreeMemory -or $needsMemory) {
  if ($needsMemory -and -not $FreeMemory) { Write-Host 'Memory is low: freeing the emulator and idle Gradle daemons first.'; $FreeMemory = [switch]::Present }
  if ($Target -eq 'phone' -and (Get-Device $true)) { Write-Host 'Stopping the emulator to free memory...'; & $adb -s (Get-Device $true) emu kill | Out-Null; Start-Sleep 5 }
  if ($FreeMemory) { Push-Location $android; & .\gradlew.bat --stop | Out-Null; Pop-Location }
  Write-Host "Free RAM now: $(Get-FreeRamGB) GB   Free commit memory now: $(Get-FreeCommitGB) GB"
  if ((Get-FreeCommitGB) -lt 5 -or (Get-FreeRamGB) -lt 2) {
    Write-Warning 'Still little memory. These use the most (close what you do not need, e.g. Chrome tabs, extra VS Code windows), then run again. Low memory makes the build very slow or fails with clang 0x5AA.'
    Show-TopMemory
  }
}

$abis = switch ($Target) { 'phone' { @('arm64-v8a') } 'emulator' { @('x86_64') } default { @('arm64-v8a', 'x86_64') } }
$env:NODE_ENV = 'production'
if ($Qa) { $env:EXPO_PUBLIC_QA = '1' } else { Remove-Item Env:\EXPO_PUBLIC_QA -ErrorAction SilentlyContinue }
foreach ($abi in $abis) {
  Write-Host "=== Building $abi (cached, incremental) ==="
  Push-Location $android
  # No --no-daemon and no clean: the daemon, build cache, .cxx objects and Metro cache are all reused.
  # The JS bundle is re-made every time (cheap, ~20 s) so a changed setting such as -Qa can never leave an old bundle behind.
  & .\gradlew.bat :app:createBundleReleaseJsAndAssets --rerun assembleRelease "-PreactNativeArchitectures=$abi" --build-cache --max-workers=2 --console=plain
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { throw "Build failed for $abi (exit $code). Read the last lines above; if you see 0x5AA, free memory and rerun." }
  $short = if ($abi -eq 'arm64-v8a') { 'arm64' } else { 'x86_64' }
  $target = Join-Path $dist "sumon-va-$short.apk"
  if (Test-Path $target) {  # keep the previous build as a rollback (last 3)
    Copy-Item $target (Join-Path $dist ("sumon-va-$short-PREV-auto-" + (Get-Date -Format 'yyyyMMdd-HHmm') + '.apk')) -Force
    Get-ChildItem $dist -Filter "sumon-va-$short-PREV-auto-*.apk" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 | Remove-Item -Force
  }
  Copy-Item (Join-Path $android 'app\build\outputs\apk\release\app-release.apk') $target -Force
  Write-Host "Saved dist\sumon-va-$short.apk"
}

$installed = $false
if (-not $NoInstall) {
  if ($abis -contains 'arm64-v8a') {
    $phone = Get-Device $false
    if ($phone) { Write-Host "Installing on the phone ($phone)..."; & $adb -s $phone install -r (Join-Path $dist 'sumon-va-arm64.apk'); $installed = ($LASTEXITCODE -eq 0) }
    else { Write-Warning 'No phone connected: the APK stays in dist\. (Plug it in, unlock it, accept "Allow USB debugging", then run:  adb install -r dist\sumon-va-arm64.apk )' }
  }
  if ($abis -contains 'x86_64') {
    $emu = Get-Device $true
    if (-not $emu) {
      Write-Host "Starting the emulator $Avd ..."
      Start-Process -FilePath $emulator -ArgumentList '-avd', $Avd, '-no-snapshot-save', '-no-boot-anim' -WindowStyle Minimized
      # wait until the emulator both shows up in `adb devices` and has finished booting (up to ~3 minutes)
      for ($i = 0; $i -lt 60 -and -not $emu; $i++) { Start-Sleep 3; $emu = Get-Device $true }
      if ($emu) { for ($i = 0; $i -lt 60; $i++) { if ((& $adb -s $emu shell getprop sys.boot_completed 2>$null) -match '1') { break }; Start-Sleep 3 } }
    }
    if (-not $emu) { throw 'The emulator did not come up. Start it from Android Studio, then run again.' }
    Write-Host "Installing on the emulator ($emu)..."; & $adb -s $emu install -r (Join-Path $dist 'sumon-va-x86_64.apk'); $installed = ($LASTEXITCODE -eq 0)
  }
}
$min = [math]::Round($clock.Elapsed.TotalMinutes, 1)
Write-Host ''
Write-Host "=== শেষ (সময় লেগেছে $min মিনিট) ==="
Write-Host ("APK: dist\ ফোল্ডারে আছে।  " + $(if ($installed) { 'ফোনে/emulator এ ইনস্টল হয়েছে।' } elseif ($NoInstall) { 'ইনস্টল করা হয়নি (-NoInstall)।' } else { 'ইনস্টল হয়নি।' }))
