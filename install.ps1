# Installs the ceangal CLI into ~\.ceangal\bin (Windows) and puts it on the
# user's PATH.
#   irm https://raw.githubusercontent.com/almide-graphics/ceangal2/main/install.ps1 | iex
# $env:CEANGAL_VERSION = "0.2.0" picks a release (default: the latest);
# $env:CEANGAL_HOME moves the install (default ~\.ceangal).
$ErrorActionPreference = "Stop"
$repo = "almide-graphics/ceangal2"
$home_ = if ($env:CEANGAL_HOME) { $env:CEANGAL_HOME } else { Join-Path $HOME ".ceangal" }
$asset = "ceangal-windows-x86_64.zip"
$url = if ($env:CEANGAL_VERSION) { "https://github.com/$repo/releases/download/v$($env:CEANGAL_VERSION.TrimStart('v'))/$asset" }
       else { "https://github.com/$repo/releases/latest/download/$asset" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("ceangal-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  Write-Host "Downloading $url"
  Invoke-WebRequest -UseBasicParsing $url -OutFile (Join-Path $tmp $asset)
  Expand-Archive -Force (Join-Path $tmp $asset) $tmp
  $bin = Join-Path $home_ "bin"
  New-Item -ItemType Directory -Force $bin | Out-Null
  Move-Item -Force (Join-Path $tmp "ceangal.exe") (Join-Path $bin "ceangal.exe")
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }

Write-Host "Installed $(& (Join-Path $bin 'ceangal.exe') --version) in $bin"
$path = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($path -split ";") -contains $bin)) {
  [Environment]::SetEnvironmentVariable("Path", (@($bin) + ($path -split ";" | Where-Object { $_ })) -join ";", "User")
  Write-Host "Added $bin to your PATH (new terminals see it)."
}
$env:Path = "$bin;$env:Path"
if (-not (Test-Path "$env:ProgramFiles\Git\bin\bash.exe")) {
  Write-Host "ceangal runs its build scripts with Git Bash: install Git for Windows (https://git-scm.com/download/win)."
}
Write-Host ""
Write-Host "Then:  ceangal new my-app; cd my-app; ceangal dev"
Write-Host "       ceangal doctor    # what each platform needs on this machine"
