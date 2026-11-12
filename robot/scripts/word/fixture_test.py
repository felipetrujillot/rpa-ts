import json
from pathlib import Path
import tempfile
import unittest
from xml.sax.saxutils import escape
from zipfile import ZipFile

import fixture


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="Word ñ ")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.request = fixture.create(self.directory)
        self.request.update(output=str(self.directory / "Salida.docx"),
                            pdf=str(self.directory / "Salida.pdf"),
                            pdfText=str(self.directory / "Salida.txt"))
        self.write_output(fixture.EXPECTED)
        Path(self.request["pdf"]).write_bytes(b"%PDF-1.7\nfixture")
        Path(self.request["pdfText"]).write_text(fixture.EXPECTED, encoding="utf-8")

    def write_output(self, text):
        with ZipFile(self.request["output"], "w") as archive:
            paragraphs = "".join("<w:p><w:r><w:t>" + escape(p) + "</w:t></w:r></w:p>" for p in text.split("\n"))
            archive.writestr("word/document.xml", '<w:document xmlns:w="' + fixture.NS[1:-1] + '"><w:body>' + paragraphs + '</w:body></w:document>')

    def test_fixture_has_two_literal_markers_and_round_trips_unicode(self):
        self.assertEqual(fixture.text(self.request["source"]).count(fixture.MARKER), 2)
        self.assertEqual(fixture.text(self.request["output"]), fixture.EXPECTED)
        self.assertTrue(fixture.verify(self.request)["ok"])

    def test_never_overwrites_an_existing_source(self):
        with self.assertRaises(FileExistsError):
            fixture.create(self.directory)

    def test_rejects_source_changes(self):
        with open(self.request["source"], "ab") as source:
            source.write(b"changed")
        self.assertFalse(fixture.verify(self.request)["checks"]["sourceUnchanged"])

    def test_rejects_partial_replacement(self):
        self.write_output(fixture.EXPECTED.replace(fixture.REPLACEMENT, fixture.MARKER, 1))
        self.assertFalse(fixture.verify(self.request)["ok"])

    def test_rejects_pdf_without_expected_text(self):
        Path(self.request["pdfText"]).write_text("incorrect", encoding="utf-8")
        self.assertFalse(fixture.verify(self.request)["checks"]["pdfContent"])

    def test_rejects_invalid_pdf_header(self):
        Path(self.request["pdf"]).write_bytes(b"not a PDF")
        self.assertFalse(fixture.verify(self.request)["checks"]["pdfHeader"])

    def test_accepts_pdf_layout_whitespace(self):
        Path(self.request["pdfText"]).write_text(fixture.EXPECTED.replace(" ", "\n"), encoding="utf-8")
        self.assertTrue(fixture.verify(self.request)["ok"])


if __name__ == "__main__":
    unittest.main()
