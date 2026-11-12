param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
function Emit($stage, $extra = @{}) {
    $extra.stage = $stage
    [Console]::WriteLine(($extra | ConvertTo-Json -Compress))
}
$word = $null
$document = $null
try {
    # A separate COM instance, never GetActiveObject or ActiveDocument.
    Emit 'connecting'
    $word = New-Object -ComObject Word.Application
    $word.Visible = $true
    $word.AutomationSecurity = 3 # msoAutomationSecurityForceDisable; never execute macros.
    Emit 'connected' @{ version = [string]$word.Version; build = [string]$word.Build }
    Emit 'opening'
    $document = $word.Documents.Open([string]$request.working, $false, $false, $false)
    Emit 'opened'
    if ($document.ReadOnly) { throw 'WORD_READ_ONLY' }
    if ($document.ProtectionType -ne -1) { throw 'WORD_PROTECTED' }
    $matches = 0
    $start = 0
    while ($true) {
        $range = $document.Range($start, $document.Content.End)
        $find = $range.Find
        $find.ClearFormatting()
        $found = $find.Execute([string]$request.marker, $true, $false, $false, $false, $false, $true, 0, $false)
        if (-not $found) { break }
        Emit 'writing'
        # Range.Text is literal: replacement ^&, backslashes, etc. are not Find codes.
        $range.Text = [string]$request.replacement
        $start = $range.End
        $matches++
        if ($matches -gt 2) { throw 'WORD_UNEXPECTED_MATCH_COUNT' }
    }
    if ($matches -ne 2) { throw 'WORD_UNEXPECTED_MATCH_COUNT' }
    Emit 'replaced' @{ matches = $matches }
    Emit 'saving'
    $document.SaveAs2([string]$request.output, 12)
    Emit 'saved'
    Emit 'exporting'
    $document.ExportAsFixedFormat([string]$request.pdf, 17)
    Emit 'exported'
    $document.Close(0)
    $document = $null
    Emit 'closed'
    Emit 'reopening'
    $document = $word.Documents.Open([string]$request.output, $false, $true, $false)
    $expected = ([string]$request.expected).Replace("`n", "`r") + "`r"
    if ($document.Content.Text -cne $expected) { throw 'WORD_REOPEN_CONTENT_MISMATCH' }
    $document.Close(0)
    $document = $null
    Emit 'completed'
} catch {
    Emit 'failed' @{ message = $_.Exception.Message; hresult = $_.Exception.HResult }
    exit 1
} finally {
    if ($null -ne $document) {
        try { $document.Close(0); Emit 'cleanupCompleted' }
        catch { Emit 'cleanupIncomplete' }
    }
    # Never Quit Word: the user could have opened another document meanwhile.
    if ($null -ne $word) {
        try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
        catch { Emit 'cleanupIncomplete' }
    }
}
