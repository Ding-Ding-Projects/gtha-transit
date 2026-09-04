param([switch]$Run)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$runtimeRoot=Join-Path $env:LOCALAPPDATA 'GTHATransit/toolchains'
$version='24.19.0'
$nodeRoot=Join-Path $runtimeRoot "node-v$version-win-x64"
$nodePath=Join-Path $nodeRoot 'node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
 New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
 $zip=Join-Path $runtimeRoot ('node-'+[guid]::NewGuid().ToString('N')+'.zip')
 $url="https://nodejs.org/dist/v$version/node-v$version-win-x64.zip"
 Write-Host "Obtaining Node.js $version from $url"
 try {
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
  if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73') { throw 'Node archive SHA-256 mismatch.' }
  Expand-Archive -LiteralPath $zip -DestinationPath $runtimeRoot -Force
 } finally {if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip}}
}
if ((& $nodePath --version) -ne "v$version") {throw 'The installed runtime version is incorrect.'}
$env:PATH=$nodeRoot+';'+$env:PATH
Set-Location -LiteralPath $projectRoot
& (Join-Path $nodeRoot 'npm.cmd') ci
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
if($Run){& (Join-Path $nodeRoot 'npm.cmd') run build;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE};& (Join-Path $nodeRoot 'npm.cmd') start;exit $LASTEXITCODE}
