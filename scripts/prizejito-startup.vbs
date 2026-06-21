Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
startupScript = fso.BuildPath(scriptDir, "start-local-on-login.ps1")
WScript.Sleep 15000
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & startupScript & """", 0, False
