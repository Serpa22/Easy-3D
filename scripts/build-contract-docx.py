"""Genera los Word de las plantillas de contrato (ver scripts/export-contracts.ts).

Uso:
  npx tsx scripts/export-contracts.ts > contratos.json
  python3 scripts/build-contract-docx.py contratos.json public/plantillas [--accent #E30613]

Requiere python-docx.

El diseño sigue el de la hoja de la app (`ContractPaper`): marca con tecla,
titular condensado en mayúsculas, rótulos con cuadradito de acento y cláusulas
con el ordinal en acento. Word no incrusta fuentes y casi nadie tiene Archivo
instalada, así que por defecto el documento nombra directamente Arial (cuerpo)
y Arial Narrow en negrita (titulares): no depende de la sustitución de fuentes
de cada programa. Quien tenga Archivo puede pedirla con `--body-font Archivo
--display-font "Archivo ExtraCondensed"`; entonces Arial / Arial Narrow quedan
solo como sugerencia (`w:altName` en `word/fontTable.xml`), que Word puede
seguir y LibreOffice ignora.
El archivo generado es determinista: el mismo JSON da los mismos bytes.
Todo el formato cuelga de estilos con nombre («E3D …») para poder retocarlo
desde el panel de estilos de Word.
"""
import argparse
import json
import io
import re
import zipfile
from pathlib import Path

from lxml import etree
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

# Identidad (los mismos valores que los tokens --doc-* de la hoja).
ACCENT = RGBColor(0xE3, 0x06, 0x13)
INK = RGBColor(0x0A, 0x0A, 0x0A)
INK_3 = RGBColor(0x5E, 0x5E, 0x5E)
RULE_HEX = "C4C4C4"
INK_HEX = "0A0A0A"

# Fuentes nombradas en el documento (de sistema por defecto) y su reserva, que
# solo se escribe (w:altName en fontTable.xml) si se pide otra familia.
BODY_FONT, BODY_FALLBACK = "Arial", "Arial"
DISPLAY_FONT, DISPLAY_FALLBACK = "Arial Narrow", "Arial Narrow"

PAGE_W, PAGE_H = Cm(21), Cm(29.7)
MARGIN_X, MARGIN_Y = Cm(2.4), Cm(2)
CONTENT_W = PAGE_W - 2 * MARGIN_X
SIGN_GAP = Cm(0.5)

HOLE = re.compile(r"(\[[^\]]+\])")
SECTION_LABELS = ("Reunidos", "Exponen", "Cláusulas")
SQUARE = "■"  # ■ el «cuadradito-tecla»
NOTICE = "Modelo orientativo según la normativa española. Revísalo con tu asesor antes de usarlo."

S_BRAND = "E3D Marca"
S_TITLE = "E3D Título"
S_DATE = "E3D Fecha"
S_SECTION = "E3D Sección"
S_CLAUSE = "E3D Cláusula"
S_BODY = "E3D Cuerpo"
S_SIGN_ROLE = "E3D Firma rol"
S_SIGN_NAME = "E3D Firma nombre"
S_FOOTER = "E3D Pie"
S_ACCENT = "E3D Acento"


# --------------------------------------------------------------------------- XML

def set_fonts(style_or_run, family):
    """Fija la familia en ascii, hAnsi y cs (python-docx solo pone las dos primeras)."""
    r_pr = style_or_run.element.get_or_add_rPr()
    r_fonts = r_pr.find(qn("w:rFonts"))
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.insert(0, r_fonts)
    for attr in list(r_fonts.attrib):
        if attr.endswith("Theme"):
            del r_fonts.attrib[attr]
    for attr in ("w:ascii", "w:hAnsi", "w:cs"):
        r_fonts.set(qn(attr), family)


def set_char_spacing(style, points):
    """Espaciado entre caracteres (w:spacing en veinteavos de punto)."""
    r_pr = style.element.get_or_add_rPr()
    spacing = OxmlElement("w:spacing")
    spacing.set(qn("w:val"), str(int(points * 20)))
    r_pr.append(spacing)


def set_lang(style, lang="es-ES"):
    r_pr = style.element.get_or_add_rPr()
    el = OxmlElement("w:lang")
    el.set(qn("w:val"), lang)
    r_pr.append(el)


def border(tag, size_eighths, color=INK_HEX, space=0):
    el = OxmlElement(f"w:{tag}")
    el.set(qn("w:val"), "single")
    el.set(qn("w:sz"), str(size_eighths))
    el.set(qn("w:space"), str(space))
    el.set(qn("w:color"), color)
    return el


def set_paragraph_border(style_or_paragraph, tag, size_eighths, color=INK_HEX, space=4):
    """Filete de párrafo. Vale para un estilo o para un párrafo suelto."""
    el = style_or_paragraph.element if hasattr(style_or_paragraph, "element") else style_or_paragraph._p
    p_pr = el.get_or_add_pPr()
    borders = p_pr.find(qn("w:pBdr"))
    if borders is None:
        borders = OxmlElement("w:pBdr")
        p_pr.append(borders)  # normalize_order() lo coloca donde pide el esquema
    borders.append(border(tag, size_eighths, color, space))


def set_cell_borders(cell, **sides):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for tag in ("top", "left", "bottom", "right"):  # orden del esquema
        if tag in sides:
            size, color = sides[tag]
            borders.append(border(tag, size, color))
    tc_pr.append(borders)


def set_cell_margins(cell, top, left, bottom, right):
    tc_pr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for tag, value in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        el = OxmlElement(f"w:{tag}")
        el.set(qn("w:w"), str(int(value.twips)))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tc_pr.append(mar)


def add_field(paragraph, instruction, style=None):
    """Campo de Word (PAGE, NUMPAGES…) con un «1» de resultado provisional."""
    def run_with(child):
        run = paragraph.add_run()
        if style:
            run.style = style
        run._r.append(child)
        return run

    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    run_with(begin)
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = f" {instruction} "
    run_with(instr)
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    run_with(sep)
    result = paragraph.add_run("1")
    if style:
        result.style = style
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run_with(end)


# Orden de los hijos que exige el esquema de Word (un w:rPr o w:pPr desordenado
# puede hacer que Word dé el archivo por dañado, aunque LibreOffice lo abra).
ORDER = {
    "w:rPr": "rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid "
             "vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang",
    "w:pPr": "pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs "
             "suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd "
             "snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment "
             "textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange",
    "w:pBdr": "top left bottom right between bar",
    "w:tcPr": "cnfStyle tcW gridSpan hMerge vMerge tcBorders shd noWrap tcMar textDirection tcFitText vAlign hideMark",
}


def normalize_order(root):
    for parent_tag, names in ORDER.items():
        rank = {qn(f"w:{name}"): i for i, name in enumerate(names.split())}
        for parent in root.iter(qn(parent_tag)):
            children = sorted(parent, key=lambda el: rank.get(el.tag, len(rank)))
            for child in children:
                parent.append(child)


def declare_fonts(doc):
    """Declara en fontTable.xml cada familia con su reserva (w:altName)."""
    part = next((p for p in doc.part.package.iter_parts() if str(p.partname) == "/word/fontTable.xml"), None)
    if part is None:
        return
    root = parse_xml(part.blob)
    for font in root.findall(qn("w:font")):
        if font.get(qn("w:name")) in (BODY_FONT, DISPLAY_FONT):
            root.remove(font)
    for family, fallback in ((BODY_FONT, BODY_FALLBACK), (DISPLAY_FONT, DISPLAY_FALLBACK)):
        if family == fallback:
            continue
        font = OxmlElement("w:font")
        font.set(qn("w:name"), family)
        for tag, value in (("altName", fallback), ("charset", "00"), ("family", "swiss"), ("pitch", "variable")):
            el = OxmlElement(f"w:{tag}")
            el.set(qn("w:val"), value)
            font.append(el)
        root.append(font)
    part._blob = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


# ------------------------------------------------------------------------ estilos

def paragraph_style(doc, name, base="Normal"):
    style = doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    style.base_style = doc.styles[base]
    style.quick_style = True
    return style


def define_styles(doc, accent):
    normal = doc.styles["Normal"]
    set_fonts(normal, BODY_FONT)
    set_lang(normal)
    normal.font.size = Pt(10)
    normal.font.color.rgb = INK
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.3
    normal.paragraph_format.widow_control = True

    body = paragraph_style(doc, S_BODY)
    body.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    brand = paragraph_style(doc, S_BRAND)
    set_fonts(brand, DISPLAY_FONT)
    brand.font.size = Pt(16)
    brand.font.bold = True
    brand.font.all_caps = True
    brand.paragraph_format.space_after = Pt(8)
    brand.paragraph_format.line_spacing = 1

    title = paragraph_style(doc, S_TITLE)
    set_fonts(title, DISPLAY_FONT)
    title.font.size = Pt(26)
    title.font.bold = True
    title.font.all_caps = True
    title.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
    title.paragraph_format.line_spacing = 0.9
    title.paragraph_format.space_before = Pt(10)
    title.paragraph_format.space_after = Pt(8)
    title.paragraph_format.keep_with_next = True
    set_paragraph_border(title, "bottom", 18, space=6)  # 2,25 pt

    date = paragraph_style(doc, S_DATE)
    date.font.bold = True
    date.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
    date.paragraph_format.space_after = Pt(4)

    # Rótulo: mayúsculas pequeñas con tracking, como los de la web.
    for label_name in (S_SECTION, S_SIGN_ROLE):
        label = paragraph_style(doc, label_name)
        label.font.size = Pt(7.5)
        label.font.bold = True
        label.font.all_caps = True
        set_char_spacing(label, 1)
        label.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
        label.paragraph_format.line_spacing = 1
        label.paragraph_format.space_after = Pt(0)
        label.paragraph_format.keep_with_next = True
    section = doc.styles[S_SECTION]
    section.paragraph_format.space_before = Pt(12)
    section.paragraph_format.space_after = Pt(7)
    set_paragraph_border(section, "bottom", 4, space=3)  # 0,5 pt

    clause = paragraph_style(doc, S_CLAUSE)
    set_fonts(clause, DISPLAY_FONT)
    clause.font.size = Pt(12)
    clause.font.bold = True
    clause.font.all_caps = True
    clause.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
    clause.paragraph_format.line_spacing = 1
    clause.paragraph_format.space_before = Pt(10)
    clause.paragraph_format.space_after = Pt(3)
    clause.paragraph_format.keep_with_next = True

    name = paragraph_style(doc, S_SIGN_NAME)
    set_fonts(name, DISPLAY_FONT)
    name.font.size = Pt(10.5)
    name.font.bold = True
    name.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
    name.paragraph_format.line_spacing = 1
    name.paragraph_format.space_before = Pt(55)  # hueco para la firma
    name.paragraph_format.space_after = Pt(0)
    set_paragraph_border(name, "top", 4, space=4)  # 0,5 pt

    footer = paragraph_style(doc, S_FOOTER)
    footer.font.size = Pt(7)
    footer.font.color.rgb = INK_3
    footer.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
    footer.paragraph_format.line_spacing = 1
    footer.paragraph_format.space_after = Pt(0)
    footer.paragraph_format.tab_stops.add_tab_stop(CONTENT_W, WD_TAB_ALIGNMENT.RIGHT)

    accent_style = doc.styles.add_style(S_ACCENT, WD_STYLE_TYPE.CHARACTER)
    accent_style.font.color.rgb = accent
    accent_style.quick_style = True


# ---------------------------------------------------------------------- contenido

def add_runs(paragraph, text, bold=None):
    """Texto con los huecos «[…]» resaltados para encontrarlos al rellenar."""
    for part in HOLE.split(text):
        if not part:
            continue
        run = paragraph.add_run(part)
        if bold is not None:
            run.bold = bold
        if HOLE.fullmatch(part):
            run.font.highlight_color = WD_COLOR_INDEX.YELLOW
    return paragraph


def add_square(paragraph, size):
    """Cuadradito-tecla en acento. Va en la fuente de cuerpo: las estrechas no siempre traen ■."""
    run = paragraph.add_run(SQUARE + " ")
    run.style = S_ACCENT
    run.font.size = Pt(size)
    set_fonts(run, BODY_FALLBACK)
    return run


def add_label(container, text, style):
    p = container.add_paragraph(style=style)
    add_square(p, 7)
    p.add_run(text)
    return p


def add_clause_heading(doc, heading):
    """«Primera. Objeto» → PRIMERA · OBJETO, con el ordinal en acento."""
    p = doc.add_paragraph(style=S_CLAUSE)
    ordinal, sep, rest = heading.partition(". ")
    if not sep:
        add_runs(p, heading)
        return p
    p.add_run(ordinal).style = S_ACCENT
    add_runs(p, f" · {rest}")
    return p


def add_signatures(doc, signatures):
    table = doc.add_table(rows=1, cols=3)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    box_w = int((CONTENT_W - SIGN_GAP) / 2)
    widths = (box_w, SIGN_GAP, box_w)
    row = table.rows[0]
    # La fila no se parte entre páginas.
    tr_pr = row._tr.get_or_add_trPr()
    tr_pr.append(OxmlElement("w:cantSplit"))
    for cell, width in zip(row.cells, widths):
        cell.width = width
    for col, width in zip(table.columns, widths):
        col.width = width

    side = (6, INK_HEX)  # 0,75 pt
    for cell, sig in zip((row.cells[0], row.cells[2]), signatures):
        set_cell_borders(cell, top=side, left=side, right=side, bottom=(24, RULE_HEX))  # canto de 3 pt
        set_cell_margins(cell, Cm(0.3), Cm(0.4), Cm(0.3), Cm(0.4))
        role = cell.paragraphs[0]
        role.style = S_SIGN_ROLE
        add_square(role, 7)
        role.add_run(sig["role"])
        add_runs(cell.add_paragraph(style=S_SIGN_NAME), sig["name"])
    gap = row.cells[1].paragraphs[0]
    gap.paragraph_format.space_after = Pt(0)
    return table


def enable_hyphenation(doc):
    """División de palabras automática (el cuerpo va justificado), en su sitio del esquema."""
    settings = doc.settings.element
    if settings.find(qn("w:autoHyphenation")) is not None:
        return
    el = OxmlElement("w:autoHyphenation")
    # En CT_Settings va justo después de w:defaultTabStop; si no está, delante del
    # primer hijo que el esquema coloca más tarde.
    before = ("writeProtection view zoom removePersonalInformation removeDateAndTime doNotDisplayPageBoundaries "
              "displayBackgroundShape printPostScriptOverText printFractionalCharacterWidth printFormsData "
              "embedTrueTypeFonts embedSystemFonts saveSubsetFonts saveFormsData mirrorMargins alignBordersAndEdges "
              "bordersDoNotSurroundHeader bordersDoNotSurroundFooter gutterAtTop hideSpellingErrors "
              "hideGrammaticalErrors activeWritingStyle proofState formsDesign attachedTemplate linkStyles "
              "stylePaneFormatFilter stylePaneSortMethod documentType mailMerge revisionView trackRevisions "
              "doNotTrackMoves doNotTrackFormatting documentProtection autoFormatOverride styleLockTheme "
              "styleLockQFSet defaultTabStop")
    earlier = {qn(f"w:{name}") for name in before.split()}
    index = 0
    for i, child in enumerate(settings):
        if child.tag in earlier:
            index = i + 1
    settings.insert(index, el)


def save_deterministic(doc, path: Path):
    """Guarda el .docx con fechas de ZIP fijas: regenerar sin cambios no toca el archivo."""
    buffer = io.BytesIO()
    doc.save(buffer)
    with zipfile.ZipFile(buffer) as src, zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            info = zipfile.ZipInfo(item.filename, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            dst.writestr(info, src.read(item.filename))


def build_header_footer(sec):
    sec.footer_distance = Cm(0.9)

    footer = sec.footer.paragraphs[0]
    footer.style = S_FOOTER
    footer.add_run(NOTICE)
    footer.add_run("\t")
    page = footer.add_run("Página ")
    page.bold = True
    add_field(footer, "PAGE")
    of = footer.add_run(" de ")
    of.bold = True
    add_field(footer, "NUMPAGES")
    for run in footer.runs[2:]:
        run.bold = True
        run.font.color.rgb = INK


def build(contract, out_dir: Path, accent):
    doc = Document()
    sec = doc.sections[0]
    sec.start_type = WD_SECTION.NEW_PAGE
    sec.page_height, sec.page_width = PAGE_H, PAGE_W
    sec.left_margin = sec.right_margin = MARGIN_X
    sec.top_margin = sec.bottom_margin = MARGIN_Y

    define_styles(doc, accent)
    declare_fonts(doc)

    core = doc.core_properties
    core.title = contract["title"]
    core.author = "Easy 3D"
    core.language = "es-ES"
    core.comments = "Modelo orientativo. Revísalo con tu asesor antes de firmarlo."

    build_header_footer(sec)
    enable_hyphenation(doc)

    signatures = contract["signatures"] or []

    # La marca va una sola vez, al principio del documento (como en la hoja de la app).
    brand = doc.add_paragraph(style=S_BRAND)
    add_square(brand, 14)
    add_runs(brand, "[Nombre comercial]")

    doc.add_paragraph(contract["title"], style=S_TITLE)
    if signatures:
        add_runs(doc.add_paragraph(style=S_DATE), contract["dateLine"])

    first = True
    for section in contract["sections"]:
        heading = section["heading"]
        if heading in SECTION_LABELS:
            add_label(doc, heading, S_SECTION)
        elif heading:
            add_clause_heading(doc, heading)
        for i, para in enumerate(section["paragraphs"]):
            p = doc.add_paragraph(style=S_BODY)
            if not heading and i == 0 and not first:
                p.paragraph_format.space_before = Pt(12)  # cierre «Y en prueba de conformidad…»
            if para.get("lead"):
                p.add_run(para["lead"] + " ").bold = True
            add_runs(p, para["text"])
        first = False

    if signatures:
        doc.paragraphs[-1].paragraph_format.keep_with_next = True
        doc.paragraphs[-1].paragraph_format.space_after = Pt(16)
        add_signatures(doc, signatures)
    else:
        p = add_runs(doc.add_paragraph(style=S_DATE), contract["dateLine"])
        p.paragraph_format.space_before = Pt(14)

    for root in (doc.element, doc.styles.element, sec.footer._element):
        normalize_order(root)

    path = out_dir / f"{contract['slug']}.docx"
    save_deterministic(doc, path)
    print(f"✓ {path}")


def parse_accent(value):
    if not re.fullmatch(r"#?[0-9a-fA-F]{6}", value):
        raise argparse.ArgumentTypeError("el acento debe ser un color hex de 6 cifras, p. ej. #E30613")
    return RGBColor.from_string(value.lstrip("#").upper())


def main():
    global BODY_FONT, DISPLAY_FONT
    parser = argparse.ArgumentParser(description="Genera los Word de las plantillas de contrato.")
    parser.add_argument("src", type=Path, help="JSON de scripts/export-contracts.ts")
    parser.add_argument("out", type=Path, help="carpeta de salida (public/plantillas)")
    parser.add_argument("--accent", type=parse_accent, default=ACCENT, help="color de acento (por defecto #E30613)")
    parser.add_argument("--body-font", default=BODY_FONT, help=f"fuente de cuerpo (por defecto {BODY_FONT}; si es otra, se declara {BODY_FALLBACK} como reserva)")
    parser.add_argument("--display-font", default=DISPLAY_FONT, help=f"fuente de titulares (por defecto {DISPLAY_FONT}; si es otra, se declara {DISPLAY_FALLBACK} como reserva)")
    args = parser.parse_args()
    BODY_FONT, DISPLAY_FONT = args.body_font, args.display_font

    args.out.mkdir(parents=True, exist_ok=True)
    for contract in json.loads(args.src.read_text(encoding="utf-8")):
        build(contract, args.out, args.accent)


if __name__ == "__main__":
    main()
