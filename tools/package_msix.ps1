# The Windows app for the Microsoft Store: an MSIX with the app, its assets
# and tiles, signed, then checked with the Windows App Certification Kit.
#
#   pwsh tools/package_msix.ps1 [-Exe <built exe>] [-Wack]
#   → $APP_OUT/msix/<key>.msix (+ wack-report.xml with -Wack)
# The app's settings come from the environment (`ceangal build windows`
# sets them); run on its own, it asks the CLI for $CEANGAL_APP's
# (default apps/playground).
#
# Signing: MSIX_PFX (path) + MSIX_PFX_PASS from secrets, with MSIX_PUBLISHER
# matching the certificate subject (Partner Center gives it). Without them a
# self-signed test certificate is made and trusted on this machine, which is
# enough for WACK, not for the Store upload (the Store re-signs anyway).
param(
  [string]$Exe = "",
  [switch]$Wack
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot/.."
Set-Location $root

if (-not $env:APP_DIR) {
  $appDir = if ($env:CEANGAL_APP) { $env:CEANGAL_APP } else { "apps/playground" }
  # Git's bash (System32\bash.exe would be WSL's)
  $bash = Join-Path $env:ProgramFiles "Git\bin\bash.exe"
  if (-not (Test-Path $bash)) { $bash = "bash" }
  (& $bash tools/ceangal env --pwsh --app $appDir) -join "`n" | Invoke-Expression
  if ($LASTEXITCODE -ne 0) { throw "ceangal env failed" }
}
$key = $env:APP_KEY
if (-not $Exe) { $Exe = "$env:APP_OUT/native/$key.exe" }
$version = "$env:APP_VERSION.0"
$publisher = if ($env:MSIX_PUBLISHER) { $env:MSIX_PUBLISHER } else { "CN=$env:APP_PUBLISHER Test" }
function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }
$name = Esc $env:APP_NAME
$description = Esc $(if ($env:APP_DESCRIPTION) { $env:APP_DESCRIPTION } else { $env:APP_NAME })
$languages = ($env:APP_LANGUAGES -split ' ' | Where-Object { $_ } | ForEach-Object { "    <Resource Language=`"$_`" />" }) -join "`n"
$network = if ($env:APP_NETWORK -eq "1") { '<Capability Name="internetClient" />' } else { "" }
# the store icons (tools/app_icons.py keeps the ones an app made by hand)
if (-not (Test-Path "$env:APP_STORE/windows")) {
  python -c "import PIL" 2>$null; if ($LASTEXITCODE -ne 0) { python -m pip install --quiet pillow }
  python tools/app_icons.py; if ($LASTEXITCODE -ne 0) { throw "app_icons.py failed" }
}

# Windows SDK tools
$kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
$sdk = Get-ChildItem $kits -Directory | Where-Object { $_.Name -match '^10\.' } | Sort-Object Name -Descending | Select-Object -First 1
$bin = Join-Path $sdk.FullName "x64"
$makeappx = Join-Path $bin "makeappx.exe"
$makepri = Join-Path $bin "makepri.exe"
$signtool = Join-Path $bin "signtool.exe"

$out = Join-Path $env:APP_OUT "msix"
$layout = Join-Path $out "layout"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$layout/Assets", "$layout/assets" | Out-Null

Copy-Item $Exe "$layout/$key.exe"
# The application manifest WACK looks for: per-monitor DPI awareness (winit
# also sets it at run time), Windows 10/11, UTF-8, the user's privileges.
$appManifest = Join-Path $out "$key.exe.manifest"
Set-Content -Encoding utf8 $appManifest @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application><supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" /></application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
      <activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>
    </windowsSettings>
  </application>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false" /></requestedPrivileges></security>
  </trustInfo>
</assembly>
'@
& (Join-Path $bin "mt.exe") -nologo -manifest $appManifest "-outputresource:$layout\$key.exe;#1"
if ($LASTEXITCODE -ne 0) { throw "mt.exe failed" }
# the app's assets first: an app's file wins over the framework's
foreach ($d in ($env:APP_ASSETS -split "`n")) {
  if (-not $d -or -not (Test-Path $d)) { continue }
  Get-ChildItem -Recurse -File $d | ForEach-Object {
    $dst = Join-Path "$layout/assets" $_.FullName.Substring((Resolve-Path $d).Path.Length)
    if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null; Copy-Item $_.FullName $dst }
  }
}
Copy-Item "$env:APP_STORE/windows/*.png" "$layout/Assets/"

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap rescap">
  <Identity Name="$env:APP_ID" Publisher="$publisher" Version="$version" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>$name</DisplayName>
    <PublisherDisplayName>$(Esc $env:APP_PUBLISHER)</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
    <Description>$description</Description>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
$languages
  </Resources>
  <Applications>
    <Application Id="App" Executable="$key.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="$name" Description="$description"
          BackgroundColor="transparent" Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    $network
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
Set-Content -Encoding utf8 "$layout/AppxManifest.xml" $manifest

# resources.pri resolves Assets\X.png to its scale / target-size variants
Push-Location $layout
& $makepri createconfig /cf "$out/priconfig.xml" /dq "lang-en-US_scale-100_contrast-standard" /o | Out-Null
& $makepri new /pr $layout /cf "$out/priconfig.xml" /mn "$layout/AppxManifest.xml" /of "$layout/resources.pri" /o | Out-Null
Pop-Location

$msix = Join-Path $out "$key.msix"
& $makeappx pack /d $layout /p $msix /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makeappx failed" }

# sign
if ($env:MSIX_PFX) {
  & $signtool sign /fd SHA256 /f $env:MSIX_PFX /p $env:MSIX_PFX_PASS $msix
} else {
  $cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature `
    -FriendlyName "$env:APP_NAME test" -CertStoreLocation "Cert:\CurrentUser\My" `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
  $pfx = Join-Path $out "test.pfx"
  $pw = ConvertTo-SecureString -String "test" -Force -AsPlainText
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pw | Out-Null
  # trust it here, so the package installs for WACK
  Import-PfxCertificate -FilePath $pfx -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" -Password $pw | Out-Null
  & $signtool sign /fd SHA256 /f $pfx /p test $msix
}
if ($LASTEXITCODE -ne 0) { throw "signtool failed" }
Write-Host "built $msix"

if ($Wack) {
  $appcert = "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\appcert.exe"
  if (-not (Test-Path $appcert)) { throw "Windows App Certification Kit not found: $appcert" }
  $report = Join-Path $out "wack-report.xml"
  & $appcert reset | Out-Null
  & $appcert test -appxpackagepath $msix -reportoutputpath $report
  [xml]$r = Get-Content $report
  $overall = "$($r.REPORT.OVERALL_RESULT)"
  Write-Host "WACK: $overall"
  $r.REPORT.REQUIREMENTS.REQUIREMENT | ForEach-Object {
    # RESULT is CDATA (an element, not a string): compare its text
    $_.TEST | Where-Object { $_.RESULT.InnerText -ne "PASS" } | ForEach-Object { Write-Host "  $($_.NAME): $($_.RESULT.InnerText) — $($_.MESSAGES.InnerText)" }
  }
  if ($overall -ne "PASS") { throw "WACK did not pass ($overall)" }
}
