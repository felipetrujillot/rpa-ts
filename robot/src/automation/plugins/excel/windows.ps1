# Dedicated STA Excel COM worker. Code is fixed; all user data arrives as JSON.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$excel = $null
$books = @{}
$mutation = $false
$written = 0
function Release-Com($object) {
  if ($null -ne $object -and [Runtime.InteropServices.Marshal]::IsComObject($object)) {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($object)
  }
}
function List-Sheets($b) {
  $items = @()
  for ($i = 1; $i -le $b.ref.Worksheets.Count; $i++) {
    $s = $b.ref.Worksheets.Item($i)
    $id = $b.id + ':sheet:' + $s.CodeName
    $b.sheets[$id] = $s
    $visibility = switch ([int]$s.Visible) { -1 { 'visible' } 0 { 'hidden' } default { 'very-hidden' } }
    $items += @{ worksheetId = $id; name = [string]$s.Name; visibility = $visibility }
  }
  return $items
}
function Perform($request) {
  $p = $request.input
  $action = $request.action
  if ($null -eq $script:excel) {
    $script:excel = New-Object -ComObject Excel.Application
    $script:excel.Visible = $true
    # This is a newly created instance, never an attached user instance.

  }
  if ($excel.Workbooks.Count -ne $books.Count) { throw 'Hay libros ajenos en la instancia administrada.' }
  if ($action -eq 'excel.workbook.open') {
    $script:mutation = $true
    $previousSecurity = $excel.AutomationSecurity
    $previousEvents = $excel.EnableEvents
    try {
      $excel.AutomationSecurity = 3
      $excel.EnableEvents = $false
      $w = $excel.Workbooks.Open($p.path, 0, $false, [Type]::Missing, '', '', $true, [Type]::Missing, [Type]::Missing, $false, $false, [Type]::Missing, $false)
    } finally {
      $excel.AutomationSecurity = $previousSecurity
      $excel.EnableEvents = $previousEvents
    }
    $b = @{ id = $p.workbookId; ref = $w; fullName = [string]$w.FullName; sheets = @{}; dirty = $true }
    $books[$p.workbookId] = $b
    if ($w.ReadOnly -or $w.HasVBProject) { throw 'Libro de solo lectura o con macros no soportado.' }
    return @{ dateSystem = $(if ($w.Date1904) { '1904' } else { '1900' }); excelVersion = [string]$excel.Version }
  }
  $b = $books[$p.workbookId]
  if ($null -eq $b -or [string]$b.ref.FullName -cne $b.fullName) { throw 'Identidad del libro invalidada.' }
  $w = $b.ref
  switch ($action) {
    'excel.worksheet.list' { return @{ worksheets = @(List-Sheets $b) } }
    'excel.worksheet.add' {
      if ($w.ProtectStructure) { throw 'La estructura del libro está protegida.' }
      foreach ($s in (List-Sheets $b)) { if ($s.name -ieq $p.name) { throw 'Nombre de hoja duplicado.' } }
      $script:mutation = $true; $b.dirty = $true
      $s = $w.Worksheets.Add([Type]::Missing, $w.Worksheets.Item($w.Worksheets.Count))
      $s.Name = $p.name
      return @((List-Sheets $b) | Where-Object { $_.name -ceq $p.name })[0]
    }
    'excel.workbook.calculate' {
      if ($excel.Workbooks.Count -ne 1) { throw 'El cálculo aislado requiere un único libro abierto.' }
      $script:mutation = $true
      $excel.CalculateFullRebuild()
      while ([int]$excel.CalculationState -ne 0) { Start-Sleep -Milliseconds 20 }
      $b.dirty = $false
      return @{ calculationPending = $false }
    }
    'excel.workbook.saveAs' {
      $script:mutation = $true
      # Save to a unique staging file; overwrite policy and atomic promotion live in the robot.
      $w.SaveAs($p.path, 51)
      $b.fullName = [string]$w.FullName
      return @{ path = $p.path }
    }
    'excel.workbook.close' {
      $script:mutation = $true
      $w.Close([bool]$p.saveChanges)
      foreach ($s in $b.sheets.Values) { Release-Com $s }
      Release-Com $w
      $books.Remove($p.workbookId)
      return @{ closed = $true }
    }
  }
  [void](List-Sheets $b)
  $s = $b.sheets[$p.worksheetId]
  if ($null -eq $s) {
    for ($i = 1; $i -le $w.Worksheets.Count; $i++) {
      $candidate = $w.Worksheets.Item($i)
      if ([string]$candidate.Name -ceq [string]$p.worksheetId) { $s = $candidate; break }
    }
  }
  if ($null -eq $s) { throw 'Hoja no encontrada en el libro.' }
  if ([int]$s.Visible -ne -1) { throw 'Las operaciones de rango y PDF requieren una hoja visible.' }
  $r = $s.Range($p.address)
  if ($action -ne 'excel.range.read' -and $s.ProtectContents) { throw 'La hoja está protegida.' }
  for ($row = 1; $row -le $r.Rows.Count; $row++) {
    for ($column = 1; $column -le $r.Columns.Count; $column++) {
      $c = $r.Cells.Item($row, $column)
      if ($c.MergeCells -or $c.HasArray) { throw 'Rango combinado o fórmula matricial no soportado.' }
      Release-Com $c
    }
  }
  switch ($action) {
    'excel.range.read' {
      $values = @(); $types = @(); $formulas = @(); $errors = @()
      for ($row = 1; $row -le $r.Rows.Count; $row++) {
        $vr = @(); $tr = @(); $fr = @(); $er = @()
        for ($column = 1; $column -le $r.Columns.Count; $column++) {
          $c = $r.Cells.Item($row, $column)
          $v = $c.Value2
          $isError = [bool]$excel.WorksheetFunction.IsError($c)
          $isEmpty = [bool]$excel.WorksheetFunction.IsBlank($c)
          $type = if ($isEmpty) { 'empty' } elseif ($isError) { 'error' } elseif ($v -is [bool]) { 'boolean' } elseif ($v -is [string]) { 'string' } else { 'number' }
          $vr += $(if ($isEmpty -or $isError) { $null } else { $v })
          $tr += $type
          $fr += $(if ($c.HasFormula) { [string]$c.Formula } else { $null })
          $er += $(if ($isError) { [string]$c.Text } else { $null })
          Release-Com $c
        }
        $values += ,$vr; $types += ,$tr; $formulas += ,$fr; $errors += ,$er
      }
      return @{ values = $values; types = $types; formulas = $formulas; errors = $errors; dateSystem = $(if ($w.Date1904) { '1904' } else { '1900' }); calculationPending = ($b.dirty -or [int]$excel.CalculationState -ne 0) }
    }
    { $_ -eq 'excel.range.writeValues' -or $_ -eq 'excel.range.writeFormulas' } {
      $script:mutation = $true; $b.dirty = $true
      for ($row = 1; $row -le $r.Rows.Count; $row++) {
        for ($column = 1; $column -le $r.Columns.Count; $column++) {
          $c = $r.Cells.Item($row, $column)
          if ($action -eq 'excel.range.writeFormulas') { $c.Formula = $p.formulas[$row - 1][$column - 1] }
          else {
            $v = $p.values[$row - 1][$column - 1]
            if ($null -eq $v) { [void]$c.ClearContents() }
            elseif ($v -is [string]) {
              $c.Value2 = "'" + $v
              if ($c.HasFormula -or [string]$c.Value2 -cne $v) { throw 'Excel no conservó el texto literal.' }
            } elseif ($v -is [bool]) { $c.Value2 = [bool]$v }
            else { $c.Value2 = [double]$v }
          }
          $script:written++
          Release-Com $c
        }
      }
      return @{ writtenCells = $written }
    }
    'excel.range.clear' { $script:mutation = $true; $b.dirty = $true; [void]$r.ClearContents(); return @{ cleared = $true } }
    'excel.range.format' {
      $script:mutation = $true
      $f = $p.format
      if ($null -ne $f.numberFormat) { $r.NumberFormat = $f.numberFormat }
      if ($null -ne $f.bold) { $r.Font.Bold = [bool]$f.bold }
      if ($null -ne $f.fill) { $r.Interior.Color = [Convert]::ToInt32($f.fill.Substring(1, 2), 16) + 256 * [Convert]::ToInt32($f.fill.Substring(3, 2), 16) + 65536 * [Convert]::ToInt32($f.fill.Substring(5, 2), 16) }
      if ($null -ne $f.columnWidth) { $r.ColumnWidth = $f.columnWidth }
      return @{ formatted = $true }
    }
    'excel.worksheet.exportPdf' {
      if ($b.dirty -or [int]$excel.CalculationState -ne 0) { throw 'Recalcula antes de exportar PDF.' }
      $script:mutation = $true
      $page = $s.PageSetup
      $page.PrintArea = $p.address
      $page.Orientation = $(if ($p.page.orientation -eq 'landscape') { 2 } else { 1 })
      $page.Zoom = $false
      $page.FitToPagesWide = $p.page.fitToPagesWide
      $page.FitToPagesTall = $p.page.fitToPagesTall
      $s.ExportAsFixedFormat(0, $p.path, 0, $true, $false, [Type]::Missing, [Type]::Missing, $false)
      return @{ path = $p.path }
    }
    default { throw 'Acción no soportada.' }
  }
}
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null; $mutation = $false; $written = 0
    try {
      $request = ConvertFrom-Json $line
      $result = Perform $request
      $response = @{ id = $request.id; ok = $true; output = $result }
    } catch {
      $response = @{ id = $request.id; ok = $false; error = $_.Exception.Message + $(if ($written) { " Celdas escritas: $written" } else { '' }); effect = $(if ($mutation) { 'uncertain' } else { 'none' }) }
    }
    [Console]::WriteLine((ConvertTo-Json -InputObject $response -Depth 30 -Compress))
    # Finalize short-lived RCWs between requests; owned workbook references stay in the map.
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  }
} finally {
  foreach ($b in $books.Values) {
    foreach ($s in $b.sheets.Values) { Release-Com $s }
    Release-Com $b.ref
  }
  Release-Com $excel
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
