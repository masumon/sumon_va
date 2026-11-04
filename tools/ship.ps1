param([switch]$Final)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $PSScriptRoot 'ship.log'
$buildScript = Join-Path $PSScriptRoot 'build-apk.ps1'
$apk = Join-Path $root 'dist\sumon-va-arm64.apk'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$package = 'com.masumon.sumonva'

function Say($message) {
    $line = '{0:HH:mm:ss}  {1}' -f (Get-Date), $message
    Write-Host $line
    Add-Content -LiteralPath $log -Value $line
}

function Stop-Ship($message, $exitCode) {
    Say "STOP: $message"
    exit $exitCode
}

try {
    Set-Location $root
    Add-Content -LiteralPath $log -Value "`n===== SHIP STARTED $(Get-Date) ====="

    Say 'Checking required files...'

    if (-not (Test-Path $buildScript)) {
        Stop-Ship 'build-apk.ps1 not found.' 1
    }

    if (-not (Test-Path $adb)) {
        Stop-Ship "Android SDK ADB not found: $adb" 1
    }

    # 1. TypeScript check
    Say 'Checking the code (tsc)...'

    try {
        $tscOutput = & npx tsc --noEmit -p . 2>&1
        $tscExit = $LASTEXITCODE
    }
    catch {
        Stop-Ship "TypeScript check could not run: $($_.Exception.Message)" 1
    }

    if ($tscExit -ne 0) {
        $tscOutput | Select-Object -First 20 | ForEach-Object {
            Say ([string]$_)
        }
        Stop-Ship 'TypeScript check failed. Build not started.' 1
    }

    Say 'TypeScript check passed.'

    # 2. Memory check
    $os = Get-CimInstance Win32_OperatingSystem
    $freeRam = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
    $freeCommit = [math]::Round($os.FreeVirtualMemory / 1MB, 1)

    Say "Free RAM: $freeRam GB; Free commit: $freeCommit GB"

    if ($freeRam -lt 4) {
        Say 'WARNING: Physical RAM is below 4 GB. Build may be slower or fail.'
    }

    if ($freeCommit -lt 6) {
        Say 'WARNING: Free commit memory is below 6 GB.'
    }

    # 3. Detect physical Android phone using the same ADB as build-apk.ps1
    $deviceOutput = & $adb devices 2>&1
    $adbExit = $LASTEXITCODE

    if ($adbExit -ne 0) {
        Stop-Ship 'ADB device detection failed.' 2
    }

    $phone = $null

    foreach ($line in $deviceOutput) {
        if ([string]$line -match '^\s*(\S+)\s+device\s*$') {
            $id = $Matches[1]

            if ($id -notlike 'emulator-*') {
                $phone = $id
                break
            }
        }
    }

    if (-not $phone) {
        Stop-Ship 'No authorized physical phone found. Connect and unlock the phone, then retry.' 2
    }

    Say "Phone connected: $phone"

    # 4. Remember previous APK timestamp. Never delete the old APK.
    $previousWrite = [datetime]::MinValue

    if (Test-Path $apk) {
        $previousWrite = (Get-Item -LiteralPath $apk).LastWriteTimeUtc
    }

    # Correct named parameter splatting
    $buildParams = @{
        Target     = 'phone'
        FreeMemory = $true
    }

    if (-not $Final) {
        $buildParams['Qa'] = $true
        Say 'Build mode: TEST (QA enabled)'
    }
    else {
        Say 'Build mode: FINAL (QA disabled)'
    }

    Say 'Starting cached Android build. No clean command will be run.'

    try {
        & $buildScript @buildParams *>> $log
        $buildInvocationOk = $?
    }
    catch {
        Stop-Ship "Build script failed: $($_.Exception.Message)" 3
    }

    if (-not $buildInvocationOk) {
        Stop-Ship 'Build script reported an execution failure.' 3
    }

    if (-not (Test-Path $apk)) {
        Stop-Ship 'Expected APK was not created.' 3
    }

    $apkInfo = Get-Item -LiteralPath $apk

    if ($apkInfo.Length -le 0 -or $apkInfo.LastWriteTimeUtc -le $previousWrite) {
        Stop-Ship 'APK was not demonstrably rebuilt. Old APK will not be installed.' 3
    }

    Say ('Fresh APK verified: {0:N1} MB' -f ($apkInfo.Length / 1MB))

    # 5. Install explicitly and verify result
    Say "Installing APK on $phone..."

    $installOutput = & $adb -s $phone install -r $apk 2>&1
    $installExit = $LASTEXITCODE

    foreach ($line in $installOutput) {
        Say ([string]$line)
    }

    if ($installExit -ne 0 -or ($installOutput -join "`n") -notmatch 'Success') {
        Stop-Ship 'APK installation failed. App will not be launched.' 4
    }

    Say 'APK installation reported Success.'

    # 6. Verify the exact package exists
    $packageOutput = & $adb -s $phone shell pm path $package 2>&1
    $packageExit = $LASTEXITCODE

    if ($packageExit -ne 0 -or ($packageOutput -join "`n") -notmatch 'package:') {
        Stop-Ship 'Installed package verification failed. App will not be launched.' 4
    }

    Say "Verified installed package: $package"

    # 7. Launch only after successful installation and verification
    Say 'Launching SUMON VA...'

    $launchOutput = & $adb -s $phone shell monkey -p $package -c android.intent.category.LAUNCHER 1 2>&1
    $launchExit = $LASTEXITCODE

    foreach ($line in $launchOutput) {
        Say ([string]$line)
    }

    if ($launchExit -ne 0) {
        Stop-Ship 'Installation succeeded, but app launch command failed.' 5
    }

    Say 'App launch command completed.'
    Say 'DONE: Build, Install and Launch completed successfully.'
}
catch {
    Say "UNEXPECTED ERROR: $($_.Exception.Message)"
    exit 10
}
