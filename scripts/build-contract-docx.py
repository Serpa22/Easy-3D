"""Genera los Word de las plantillas de contrato (ver scripts/export-contracts.ts).

Uso: python3 scripts/build-contract-docx.py contratos.json public/plantillas
Requiere python-docx.
"""
import json
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

INK = RGBColor(0x0A, 0x0A, 0x0A)
MUTED = RGBColor(0x52, 0x52, 0x52)
HOLE = re.compile(r"(\[[^\]]+\])")
CENTERED = ("Reunidos", "Exponen", "Cláusulas")


def add_runs(paragraph, text, bold=False):
    """Texto con los huecos «[…]» resaltados para encontrarlos al rellenar."""
    for part in HOLE.split(text):
        if not part:
            continue
        run = paragraph.add_run(part)
        run.bold = bold
        if HOLE.fullmatch(part):
            run.font.highlight_color = WD_COLOR_INDEX.YELLOW
    return paragraph


def top_border(paragraph):
    p_pr = paragraph._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    top = OxmlElement("w:top")
    for k, v in {"w:val": "single", "w:sz": "6", "w:space": "4", "w:color": "0A0A0A"}.items():
        top.set(qn(k), v)
    borders.append(top)
    p_pr.append(borders)


def build(contract, out_dir: Path):
    doc = Document()
    sec = doc.sections[0]
    sec.page_height, sec.page_width = Cm(29.7), Cm(21)
    sec.left_margin = sec.right_margin = Cm(2.2)
    sec.top_margin = sec.bottom_margin = Cm(2)

    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = INK
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.15

    core = doc.core_properties
    core.title = contract["title"]
    core.author = "Easy 3D"
    core.comments = "Modelo orientativo. Revísalo con tu asesor antes de firmarlo."

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run(contract["title"].upper())
    run.bold = True
    run.font.size = Pt(14)

    if contract["signatures"]:
        p = add_runs(doc.add_paragraph(), contract["dateLine"])
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(14)

    for section in contract["sections"]:
        heading = section["heading"]
        if heading:
            h = doc.add_paragraph()
            centered = heading in CENTERED
            h.add_run(heading.upper() if centered else heading).bold = True
            h.paragraph_format.space_before = Pt(10)
            h.paragraph_format.keep_with_next = True
            if centered:
                h.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for para in section["paragraphs"]:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            if para.get("lead"):
                p.add_run(para["lead"] + " ").bold = True
            add_runs(p, para["text"])

    if contract["signatures"]:
        table = doc.add_table(rows=1, cols=2)
        for cell, sig in zip(table.rows[0].cells, contract["signatures"]):
            spacer = cell.paragraphs[0]
            spacer.paragraph_format.space_before = Pt(60)
            role = cell.add_paragraph()
            top_border(role)
            role.add_run(sig["role"]).bold = True
            name = add_runs(cell.add_paragraph(), sig["name"])
            for r in name.runs:
                r.font.color.rgb = MUTED
    else:
        p = add_runs(doc.add_paragraph(), contract["dateLine"])
        p.paragraph_format.space_before = Pt(14)

    footer = sec.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fr = footer.add_run("Modelo orientativo según la normativa española. Revísalo con tu asesor antes de usarlo.")
    fr.font.size = Pt(8)
    fr.font.color.rgb = MUTED

    path = out_dir / f"{contract['slug']}.docx"
    doc.save(path)
    print(f"✓ {path}")


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for contract in json.loads(src.read_text(encoding="utf-8")):
        build(contract, out)


if __name__ == "__main__":
    main()
