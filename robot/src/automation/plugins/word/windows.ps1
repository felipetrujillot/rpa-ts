$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$word = $null
$documents = @{}
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    $mutation = $false
    try {
        $request = $line | ConvertFrom-Json
        $p = $request.input
        if ($null -eq $word) { $word = New-Object -ComObject Word.Application; $word.Visible = $true; $word.AutomationSecurity = 3 }
        if ($request.action -eq 'word.document.open') {
            foreach ($existing in $word.Documents) {
                if ($existing.FullName -eq $p.documentPath) { throw 'WORD_DOCUMENT_CONFLICT' }
            }
            $mutation = $true
            $document = $word.Documents.Open([string]$p.documentPath, $false, $false, $false)
            $documents[$p.documentId] = $document
            $output = @{ wordVersion = [string]$word.Version }
        } else {
            $document = $documents[$p.documentId]
            if ($null -eq $document -or $document.FullName -ne $p.documentPath) { throw 'WORD_DOCUMENT_NOT_FOUND' }
            $output = @{}
            switch ($request.action) {
                'word.document.readText' { $output = @{ text = [string]$document.Content.Text } }
                'word.document.close' {
                    if ($p.changes -eq 'rejectIfDirty' -and -not $document.Saved) { throw 'WORD_DOCUMENT_DIRTY' }
                    $mutation = $true
                    $save = if ($p.changes -eq 'save') { -1 } else { 0 }
                    $document.Close($save)
                    $documents.Remove($p.documentId)
                    $output = @{ closed = $true }
                }
                default {
                    if ($document.ReadOnly) { throw 'WORD_READ_ONLY' }
                    if ($document.ProtectionType -ne -1) { throw 'WORD_PROTECTED' }
                    switch ($request.action) {
                        'word.document.applyEdits' {
                            if ($document.Content.Text -cne [string]$p.expectedText) { throw 'WORD_DOCUMENT_CHANGED' }
                            foreach ($edit in $p.edits) {
                                $range = $document.Range([int]$edit.start, [int]$edit.end)
                                $mutation = $true
                                $range.Text = [string]$edit.text
                            }
                        }
                        'word.document.saveAs' { $mutation = $true; $document.SaveAs2([string]$p.path, 12); $output = @{ path = $p.path } }
                        'word.document.exportPdf' { $mutation = $true; $document.ExportAsFixedFormat([string]$p.path, 17); $output = @{ path = $p.path } }
                        default { throw 'WORD_UNKNOWN_ACTION' }
                    }
                }
            }
        }
        $response = @{ id = $request.id; ok = $true; output = $output }
    } catch {
        $effect = if ($mutation) { 'uncertain' } else { 'none' }
        $response = @{ id = $request.id; ok = $false; error = $_.Exception.Message; effect = $effect }
    }
    [Console]::WriteLine(($response | ConvertTo-Json -Depth 20 -Compress))
}
# Parent closes its own documents explicitly. Never Quit Word, even on EOF.
