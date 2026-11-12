"""Disposable, identical OOXML fixture and independent verification (stdlib only)."""
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

MARKER = "{{cliente}}"
REPLACEMENT = 'María Muñoz — "comillas", \\, $(), `texto`, ^&, <>&'
PARAGRAPHS = ["Prueba Word RPA: áéíóú ñ", "Cliente: " + MARKER,
              "Segunda coincidencia: " + MARKER, "Fin de la prueba."]
EXPECTED = "\n".join(PARAGRAPHS).replace(MARKER, REPLACEMENT)
NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def text(path):
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    return "\n".join("".join(p.itertext()) for p in root.iter(NS + "p"))


def create(directory, protected=False):
    directory = Path(directory)
    source = directory / "Plantilla original ñ.docx"
    body = "".join('<w:p><w:r><w:t xml:space="preserve">' + escape(p) +
                   "</w:t></w:r></w:p>" for p in PARAGRAPHS)
    with ZipFile(source, "x", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'''.replace('</Types>', ('<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' if protected else '') + '</Types>'))
        archive.writestr("_rels/.rels", '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>''')
        archive.writestr("word/document.xml", '<w:document xmlns:w="' + NS[1:-1] + '"><w:body>' + body + "<w:sectPr/></w:body></w:document>")
        if protected:
            archive.writestr("word/settings.xml", '<w:settings xmlns:w="' + NS[1:-1] + '"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>')
            archive.writestr("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>')
    return dict(source=str(source), sourceSha256=digest(source), marker=MARKER,
                replacement=REPLACEMENT, expected=EXPECTED, matches=2)


def verify(request):
    source = Path(request["source"])
    output = Path(request["output"])
    pdf = Path(request["pdf"])
    pdf_text = Path(request["pdfText"]).read_text(encoding="utf-8")
    expected = request.get("expected", EXPECTED)
    checks = dict(sourceUnchanged=digest(source) == request["sourceSha256"],
                  docxContent=text(output) == expected,
                  pdfHeader=pdf.read_bytes().startswith(b"%PDF-"),
                  pdfContent=" ".join(expected.split()) in " ".join(pdf_text.split()))
    return dict(ok=all(checks.values()), checks=checks,
                files=[dict(path=str(p), bytes=p.stat().st_size, sha256=digest(p))
                       for p in [source, output, pdf]])


if __name__ == "__main__":
    if sys.argv[1] in ["create", "create-protected"]:
        result = create(sys.argv[2], protected=sys.argv[1] == "create-protected")
    elif sys.argv[1] == "verify":
        result = verify(json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")))
    else:
        raise ValueError("Unknown command")
    print(json.dumps(result, ensure_ascii=False))
