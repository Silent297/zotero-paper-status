# Kills only Zotero instances started from this project (dev profile / test data),
# leaving the regular Zotero instance untouched.
$targets = Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" |
  Where-Object { $_.CommandLine -like '*zotero-paper-status*' }
foreach ($t in $targets) {
  Stop-Process -Id $t.ProcessId -Force
}
