# =============================================================================
#  Reasoning Effort Bridge - one-shot install script (run with Windows PowerShell 5.1+)
#  ---------------------------------------------------------------------------
#  What it does:
#    1. copies the host plugin package into the DSH profile
#    2. APPENDS one entry to the profile cordis.patch.yml (never rewrites or
#       re-formats what is already there - other plugins' patches and comments
#       are preserved byte for byte)
#  No apiproxy whitelist patch and no harness source patch are needed: the
#  plugin registers no new settings namespace (it only writes the existing
#  `llm-pi-ai` namespace host-side) and ships no browser half.
#  Then restart `dsh web` and hard-refresh the browser (Ctrl+Shift+R).
# =============================================================================
param(
  [string]$DshHome   = "$env:USERPROFILE\.dsh",
  [string]$SourceDir = "D:\DSH\pj\reasoning-effort-bridge"
)

$ErrorActionPreference = 'Stop'
# BOM-free UTF-8 writer: PS 5.1's `Set-Content -Encoding UTF8` always prepends a
# BOM, which breaks YAML parsing once it lands in front of a content line (the
# loader's yaml parser reads it as part of the first scalar).
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

# --- 1) copy package ----------------------------------------------------------
$hostPkg = Join-Path $DshHome 'profiles\node_modules\@jd962\dsh-reasoning-effort-bridge'
New-Item -ItemType Directory -Force -Path "$hostPkg\lib" | Out-Null
Copy-Item -Recurse -Force "$SourceDir\host\lib\*" "$hostPkg\lib\"
Copy-Item -Force "$SourceDir\host\package.json" "$hostPkg\"
Write-Output "[ok] copied host package to $hostPkg"

# --- 2) merge-append the profile patch (idempotent, text-level) ---------------
$patchDst  = Join-Path $DshHome 'profiles\web\cordis.patch.yml'
$snippet   = Join-Path $SourceDir 'profile-cordis.append.yml'
if (-not (Test-Path $patchDst)) {
  # No patch file yet: create one holding just this snippet (without its comment header).
  $entry = (Get-Content $snippet -Raw -Encoding UTF8) -replace '(?s)^#.*?^- insert', '- insert'
  Write-Utf8NoBom $patchDst $entry
  Write-Output "[ok] created $patchDst with the bridge entry"
} else {
  $content = Get-Content $patchDst -Raw -Encoding UTF8
  if ($content -match "name:\s*'@jd962/dsh-reasoning-effort-bridge'") {
    Write-Output "[ok] profile cordis.patch.yml already contains the bridge entry"
  } else {
    $entry = (Get-Content $snippet -Raw -Encoding UTF8) -replace '(?s)^#.*?^- insert', '- insert'
    # Normalize separators: exactly one blank line between the existing tail and the new entry.
    if (-not $content.EndsWith("`n")) { $content = $content + "`n" }
    $content = $content.TrimEnd("`n") + "`n`n" + $entry.TrimEnd("`n") + "`n"
    Write-Utf8NoBom $patchDst $content
    Write-Output "[ok] appended the bridge entry to $patchDst"
  }
}

# --- 3) validate the merged YAML parses (uses the yaml package the profile already ships) ---
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node -ne $null) {
  $yamlPkg = Join-Path $DshHome 'profiles\node_modules\yaml\package.json'
  if (Test-Path $yamlPkg) {
    $env:NODE_PATH = Split-Path (Split-Path $yamlPkg -Parent) -Parent
    $check = node -e ("const fs=require('fs');const {createRequire}=require('module');" +
      "const req=createRequire(process.env.NODE_PATH+'/yaml/package.json');" +
      "const YAML=req('yaml');" +
      "const doc=YAML.parse(fs.readFileSync(process.argv[1],'utf8'));" +
      "if(!Array.isArray(doc)) throw new Error('patch file is not a top-level array');" +
      "const ids=[];(function walk(v){if(Array.isArray(v)){v.forEach(walk);return;}if(v&&typeof v==='object'){if(v.id)ids.push(String(v.id));Object.values(v).forEach(walk);}})(doc);" +
      "console.log('parsed entries ids: '+ids.join(', '));") $patchDst 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Output "[ok] merged patch YAML valid: $check" }
    else { Write-Warning "[warn] patch YAML validation failed: $check" }
  } else {
    Write-Output "[skip] yaml package not found under the profile; skipped validation"
  }
} else {
  Write-Output "[skip] node not found; skipped YAML validation"
}

Write-Output ""
Write-Output "Install complete. Next steps:"
Write-Output "  1. restart dsh web  (Ctrl+C in the dsh terminal, then: dsh web)"
Write-Output "  2. hard-refresh the browser (Ctrl+Shift+R)"
Write-Output "  3. open the composer model menu: third-party models now show"
Write-Output "     Off/Low/Medium/High/Xhigh/Max (models that already declared their"
Write-Output "     own levels, or opted out with reasoningEfforts: false, are untouched)"
