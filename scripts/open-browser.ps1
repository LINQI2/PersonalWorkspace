param([int]$Port = 3000)
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/meta" -UseBasicParsing -TimeoutSec 1
    if ($response.StatusCode -eq 200) { Start-Process "http://127.0.0.1:$Port"; exit }
  } catch {}
  Start-Sleep -Milliseconds 500
}
