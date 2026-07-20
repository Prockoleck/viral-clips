$logFile = "$PSScriptRoot\server.log"
$python = "python"
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$app = "$PSScriptRoot\app.py"

# Kill existing processes
Get-Process -Name "python" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force

Start-Transcript -Path $logFile -Append

# Start Flask server
Write-Output "Starting Flask server..."
$pyProc = Start-Process -NoNewWindow -FilePath $python -ArgumentList $app -PassThru

Start-Sleep -Seconds 2

# Start Cloudflare tunnel
Write-Output "Starting Cloudflare tunnel..."
$cfProc = Start-Process -NoNewWindow -FilePath $cloudflared -ArgumentList "tunnel --url http://localhost:8080" -PassThru

Write-Output "Servers started. Flask PID: $($pyProc.Id), Cloudflare PID: $($cfProc.Id)"
Write-Output "Check the tunnel URL in the cloudflared output above."
Write-Output "Run: Get-Process python,cloudflared to verify."

Stop-Transcript
