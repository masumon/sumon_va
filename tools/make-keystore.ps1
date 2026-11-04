# Creates the app's OWN release signing key (one time). You type the password yourself; it is never printed or saved anywhere
# except the gitignored keystore.properties next to this app. KEEP A COPY of va-release.jks and the password in a safe place:
# lose either and the app can never be updated over the old install.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$jks = Join-Path $root 'android\app\va-release.jks'
if (Test-Path $jks) { Write-Host 'A key already exists. Nothing changed.'; exit 0 }
$keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
if (-not $keytool) { $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe' }
$pw = Read-Host 'Choose a key password (min 8 characters)' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
if ($plain.Length -lt 8) { throw 'Password too short.' }
& $keytool -genkeypair -v -storetype PKCS12 -keystore $jks -alias va -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass $plain -keypass $plain -dname 'CN=Sumon Virtual Assistant, O=ABO ENTERPRISE, C=BD'
Set-Content -Path (Join-Path $root 'android\keystore.properties') -Value "storeFile=app/va-release.jks`nstorePassword=$plain`nkeyAlias=va`nkeyPassword=$plain" -Encoding ASCII
$gi = Join-Path $root '.gitignore'
$add = @('android/keystore.properties', 'android/app/*.jks') | Where-Object { -not (Select-String -Path $gi -SimpleMatch $_ -Quiet) }
if ($add) { Add-Content -Path $gi -Value $add }
Write-Host 'Done. Back up android\app\va-release.jks and remember the password.'
