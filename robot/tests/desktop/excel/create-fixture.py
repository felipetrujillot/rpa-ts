"""Generate the tiny OOXML template used by the optional native Excel tests (stdlib only)."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

path = Path(__file__).with_name('template.xlsx')
files = {
    '[Content_Types].xml': '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>''',
    '_rels/.rels': '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''',
    'xl/workbook.xml': '''<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/><sheet name="Resumen" sheetId="2" r:id="rId2"/></sheets><calcPr calcMode="manual"/></workbook>''',
    'xl/_rels/workbook.xml.rels': '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>''',
    'xl/worksheets/sheet1.xml': '''<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Precio</t></is></c><c r="B1" t="inlineStr"><is><t>Cantidad</t></is></c><c r="C1" t="inlineStr"><is><t>Subtotal</t></is></c></row><row r="2"><c r="A2"><v>10</v></c><c r="B2"><v>2</v></c><c r="C2"><f>A2*B2</f><v>20</v></c></row><row r="3"><c r="A3"><v>5</v></c><c r="B3"><v>3</v></c><c r="C3"><f>A3*B3</f><v>15</v></c></row></sheetData></worksheet>''',
    'xl/worksheets/sheet2.xml': '''<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Total</t></is></c><c r="B1"><f>SUM(Datos!C2:C3)</f><v>35</v></c></row></sheetData></worksheet>''',
}
with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
    for name, text in files.items():
        archive.writestr(name, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + text)
print(path)

with ZipFile(path.with_name('dates-1904.xlsx'), 'w', ZIP_DEFLATED) as archive:
    for name, text in files.items():
        if name == 'xl/workbook.xml':
            text = text.replace('date1904="0"', 'date1904="1"')
        archive.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + text)

# An encoded external relationship must also be rejected before Excel sees it.
with ZipFile(path.with_name('external-links.xlsx'), 'w', ZIP_DEFLATED) as archive:
    for name, text in files.items():
        if name == 'xl/_rels/workbook.xml.rels':
            text = text.replace('</Relationships>', '<Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.invalid/book.xlsx" TargetMode="Exter&#110;al"/></Relationships>')
        archive.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + text)
