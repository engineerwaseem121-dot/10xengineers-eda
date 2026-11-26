# Packages the extension into dist/<name>-<version>.vsix without needing Node/vsce.
# Usage:  powershell -ExecutionPolicy Bypass -File build-vsix.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$pkg = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$id = "$($pkg.publisher).$($pkg.name)"

# keep the Verilog grammar in sync with the SystemVerilog one
$sv = Get-Content (Join-Path $root 'syntaxes/systemverilog.tmLanguage.json') -Raw -Encoding UTF8
$v = $sv.Replace('"scopeName": "source.systemverilog.tenx"', '"scopeName": "source.verilog.tenx"').Replace('"name": "SystemVerilog (10xEngineers EDA)"', '"name": "Verilog (10xEngineers EDA)"')
[IO.File]::WriteAllText((Join-Path $root 'syntaxes/verilog.tmLanguage.json'), $v, (New-Object Text.UTF8Encoding $false))

$include = @('package.json', 'extension.js', 'README.md', 'CHANGELOG.md', 'LICENSE.txt', 'icon.png', 'language-configuration.json', 'language-configuration-riscv.json', 'language-configuration-ld.json')
$dirs = @('src', 'media', 'syntaxes', 'snippets', 'examples', 'schemas', 'images', 'container')

$files = New-Object System.Collections.Generic.List[string]
foreach ($f in $include) { if (Test-Path (Join-Path $root $f)) { $files.Add($f) } else { throw "Missing $f" } }
foreach ($d in $dirs) {
  Get-ChildItem -Path (Join-Path $root $d) -Recurse -File | ForEach-Object {
    $files.Add($_.FullName.Substring($root.Length + 1).Replace('\', '/'))
  }
}

function Esc([string]$s) { return [Security.SecurityElement]::Escape($s) }
$tags = ($pkg.keywords -join ',')
$cats = ($pkg.categories -join ',')
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$(Esc $pkg.name)" Version="$(Esc $pkg.version)" Publisher="$(Esc $pkg.publisher)" />
    <DisplayName>$(Esc $pkg.displayName)</DisplayName>
    <Description xml:space="preserve">$(Esc $pkg.description)</Description>
    <Tags>$(Esc $tags)</Tags>
    <Categories>$(Esc $cats)</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$(Esc $pkg.engines.vscode)" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Services.Branding.Color" Value="$(Esc $pkg.galleryBanner.color)" />
      <Property Id="Microsoft.VisualStudio.Services.Branding.Theme" Value="$(Esc $pkg.galleryBanner.theme)" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
"@

$exts = $files | ForEach-Object { [IO.Path]::GetExtension($_).ToLower() } | Where-Object { $_ } | Sort-Object -Unique
$mime = @{ '.do' = 'text/plain'; '.yaml' = 'text/plain'; '.testplan' = 'text/plain'; '.csv' = 'text/plain'; '.s' = 'text/plain'; '.ld' = 'text/plain'; '.xlsx' = 'application/octet-stream'; '.f' = 'text/plain'; '.json' = 'application/json'; '.js' = 'application/javascript'; '.md' = 'text/markdown'; '.txt' = 'text/plain'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.css' = 'text/css'; '.sv' = 'text/plain'; '.v' = 'text/plain'; '.vcd' = 'text/plain'; '.ps1' = 'text/plain'; '.vsixmanifest' = 'text/xml' }
$ct = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".vsixmanifest" ContentType="text/xml" />'
foreach ($e in $exts) { $t = $mime[$e]; if (-not $t) { $t = 'application/octet-stream' }; $ct += "<Default Extension=`"$e`" ContentType=`"$t`" />" }
$ct += '</Types>'

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$out = Join-Path $dist "$($pkg.name)-$($pkg.version).vsix"
if (Test-Path $out) { Remove-Item $out -Force }

$utf8 = New-Object Text.UTF8Encoding $false
$zip = [IO.Compression.ZipFile]::Open($out, 'Create')
try {
  function AddText($name, $text) {
    $e = $zip.CreateEntry($name, 'Optimal')
    $s = $e.Open(); $b = $utf8.GetBytes($text); $s.Write($b, 0, $b.Length); $s.Dispose()
  }
  AddText 'extension.vsixmanifest' $manifest
  AddText '[Content_Types].xml' $ct
  foreach ($f in $files) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $f), "extension/$f", 'Optimal') | Out-Null
  }
} finally { $zip.Dispose() }

Write-Host "Built $out  ($id, $($files.Count) files)"
