# Pull the server's newest backups to this PC. Run by hand or by Task Scheduler.
$k="$env:USERPROFILE\.ssh\sheetal_server"; $dst="$env:USERPROFILE\Documents\sheetal-backups"
New-Item -ItemType Directory -Force $dst | Out-Null
scp -o IdentitiesOnly=yes -i $k "root@45.117.153.121:/var/backups/sheetal/*" $dst
Get-ChildItem $dst | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item
