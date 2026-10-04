# The Windows app for the Microsoft Store: an MSIX with the playground,
# its assets and tiles, signed, then checked with the Windows App
# Certification Kit.
#
#   pwsh tools/package_msix.ps1 [-Exe out/playground.exe] [-Wack]
#   → out/msix/playground.msix (+ out/msix/wack-report.xml with -Wack)
#
# Signing: MSIX_PFX (path) + MSIX_PFX_PASS from secrets, with MSIX_PUBLISHER
# matching the certificate subject (Partner Center gives it). Without them a
# self-signed test certificate is made and trusted on this machine, which is
# enough for WACK, not for the Store upload (the Store re-signs anyway).
param(
  [string]$Exe = "out/playground.exe",
  [switch]$Wack
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot/.."
Set-Location $root

# app.env: KEY=value lines
$envFile = Get-Content "apps/playground/app.env" | Where-Object { $_ -match '^[A-Z_]+=' }
$app = @{}
foreach ($l in $envFile) { $k, $v = $l -split '=', 2; $app[$k] = $v.Trim('"') }
$version = "$($app.VERSION).0"
$publisher = if ($env:MSIX_PUBLISHER) { $env:MSIX_PUBLISHER } else { "CN=Almide Playground Test" }

# Windows SDK tools
$kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
$sdk = Get-ChildItem $kits -Directory | Where-Object { $_.Name -match '^10\.' } | Sort-Object Name -Descending | Select-Object -First 1
$bin = Join-Path $sdk.FullName "x64"
$makeappx = Join-Path $bin "makeappx.exe"
$makepri = Join-Path $bin "makepri.exe"
$signtool = Join-Path $bin "signtool.exe"

$out = Join-Path $root "out/msix"
$layout = Join-Path $out "layout"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$layout/Assets", "$layout/assets" | Out-Null

Copy-Item $Exe "$layout/playground.exe"
foreach ($d in ($app.APP_ASSETS -split ' ')) {
  Copy-Item -Recurse -Force "$d/*" "$layout/assets/"
}
Copy-Item "store/playground/windows/*.png" "$layout/Assets/"

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap rescap">
  <Identity Name="$($app.APP_ID)" Publisher="$publisher" Version="$version" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>$($app.APP_NAME)</DisplayName>
    <PublisherDisplayName>Almide</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
    <Description>Write, run and share Almide programs.</Description>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
    <Resource Language="ja-jp" />
  </Resources>
  <Applications>
    <Application Id="Playground" Executable="playground.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="$($app.APP_NAME)" Description="Write, run and share Almide programs"
          BackgroundColor="transparent" Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <!-- the AI assistant calls the provider the user picked -->
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
Set-Content -Encoding utf8 "$layout/AppxManifest.xml" $manifest

# resources.pri resolves Assets\X.png to its scale / target-size variants
Push-Location $layout
& $makepri createconfig /cf "$out/priconfig.xml" /dq en-US /o | Out-Null
& $makepri new /pr $layout /cf "$out/priconfig.xml" /mn "$layout/AppxManifest.xml" /of "$layout/resources.pri" /o | Out-Null
Pop-Location

$msix = Join-Path $out "playground.msix"
& $makeappx pack /d $layout /p $msix /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makeappx failed" }

# sign
if ($env:MSIX_PFX) {
  & $signtool sign /fd SHA256 /f $env:MSIX_PFX /p $env:MSIX_PFX_PASS $msix
} else {
  $cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature `
    -FriendlyName "Almide Playground test" -CertStoreLocation "Cert:\CurrentUser\My" `
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
  $overall = $r.REPORT.OVERALL_RESULT
  Write-Host "WACK: $overall"
  $r.REPORT.REQUIREMENTS.REQUIREMENT | ForEach-Object {
    $_.TEST | Where-Object { $_.RESULT -ne "PASS" } | ForEach-Object { Write-Host "  $($_.NAME): $($_.RESULT) — $($_.MESSAGES.MESSAGE.TEXT)" }
  }
  if ($overall -ne "PASS") { throw "WACK did not pass ($overall)" }
}
