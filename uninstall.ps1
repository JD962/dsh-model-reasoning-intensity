# =============================================================================
#  Reasoning Effort Bridge - uninstall script (run with Windows PowerShell 5.1+)
#  ---------------------------------------------------------------------------
#  What it does:
#    1. removes the bridge entry from the profile cordis.patch.yml (text-level;
#       other plugins' entries and comments stay byte for byte)
#    2. deletes the host plugin package from the profile
#  The reasoningEfforts maps already written into settings.yaml are USER data:
#  they stay (remove a map from a model, or set reasoningEfforts: false on it,
#  to make that model stop offering levels). Re-running install.ps1 re-adds the
#  plugin; it re-fills only entries that still lack the field.
#  Then restart `dsh web`.
# =============================================================================
param(
  [string]$DshHome   = "$env:USERPROFILE\.dsh",
  [string]$SourceDir = "D:\DSH\pj\reasoning-effort-bridge"
)

$ErrorActionPreference = 'Stop'
# BOM-free UTF-8 writer: PS 5.1's `Set-Content -Encoding UTF8` always prepends a
# BOM, which breaks YAML parsing once it lands in front of a content line.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# --- 1) remove the patch entry (idempotent, line-wise) -------------------------
$patchDst = Join-Path $DshHome 'profiles\web\cordis.patch.yml'
if (-not (Test-Path $patchDst)) {
  Write-Output "[ok] no profile cordis.patch.yml found (nothing to remove)"
} else {
  $content = Get-Content $patchDst -Raw -Encoding UTF8
  if ($content -notmatch "name:\s*'@jd962/dsh-reasoning-effort-bridge'") {
    Write-Output "[ok] profile cordis.patch.yml has no bridge entry (already removed)"
  } else {
    # Two passes, no closures over loop state (PowerShell script-block scoping
    # drops writes to outer variables):
    #   pass 1 - split into preamble + top-level entries ('- ' at line start);
    #            an entry belongs to the bridge iff its body names the package
    #   pass 2 - rebuild, dropping bridge entries AND the contiguous blank +
    #            comment lines directly above each dropped entry
    $lines = $content -split "`r?`n"
    $preamble = New-Object System.Collections.Generic.List[string]
    $entries = New-Object System.Collections.Generic.List[object]
    $current = $null
    foreach ($line in $lines) {
      if ($line -match '^- ') {
        if ($current -ne $null) { $entries.Add($current) }
        $current = New-Object PSObject -Property @{ Lines = (New-Object System.Collections.Generic.List[string]); Bridge = $false }
      }
      if ($current -eq $null) {
        $preamble.Add($line)
      } else {
        $current.Lines.Add($line)
        if ($line -match "dsh-reasoning-effort-bridge") { $current.Bridge = $true }
      }
    }
    if ($current -ne $null) { $entries.Add($current) }

    $dropped = $false
    $kept = New-Object System.Collections.Generic.List[string]
    foreach ($line in $preamble) { $kept.Add($line) }
    foreach ($entry in $entries) {
      if ($entry.Bridge) {
        $dropped = $true
        # Strip this entry's leading comment/blank preamble off what is kept.
        while ($kept.Count -gt 0) {
          $tail = $kept[$kept.Count - 1]
          if ($tail -match '^\s*#' -or $tail -match '^\s*$') { $kept.RemoveAt($kept.Count - 1) } else { break }
        }
        continue
      }
      foreach ($line in $entry.Lines) { $kept.Add($line) }
    }
    if (-not $dropped) {
      throw "bridge entry was not found for removal - remove it manually from $patchDst"
    }

    $new = ($kept -join "`n").TrimEnd("`n") + "`n"
    # Collapse doubled blank lines left where the block was removed.
    $new = $new -replace "(`n){3,}", "`n`n"
    if ($new -match "name:\s*'@jd962/dsh-reasoning-effort-bridge'") {
      throw "bridge entry still present after removal - remove it manually from $patchDst"
    }
    [System.IO.File]::WriteAllText($patchDst, $new, $Utf8NoBom)
    Write-Output "[ok] removed the bridge entry from $patchDst"
  }
}

# --- 2) delete the package -----------------------------------------------------
$hostPkg = Join-Path $DshHome 'profiles\node_modules\@jd962\dsh-reasoning-effort-bridge'
if (Test-Path $hostPkg) {
  Remove-Item -Recurse -Force $hostPkg
  if (Test-Path $hostPkg) { throw "removal verification failed: $hostPkg still exists" }
  Write-Output "[ok] removed $hostPkg"
} else {
  Write-Output "[ok] package already absent"
}

Write-Output ""
Write-Output "Uninstall complete. Restart dsh web to fully unload the plugin."
