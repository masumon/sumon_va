Set-Location 'E:\sumon_VA'
& 'E:\sumon_VA\tools\build-apk.ps1' -Target phone -FreeMemory *> 'E:\sumon_VA\tools\last-build.log'
Start-Sleep 3
& 'C:\Users\masum\AppData\Local\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe' -s 10EDAX04RL0002X shell monkey -p com.masumon.sumonva -c android.intent.category.LAUNCHER 1 *>> 'E:\sumon_VA\tools\last-build.log'
Add-Content 'E:\sumon_VA\tools\last-build.log' ('DONE ' + (Get-Date))
