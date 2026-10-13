"""Builds the test fonts in this folder (fontTools; see README.md). Run: python3 build.py

Every glyph is a box, so widths and pixels are easy to predict. Units per em: 1000, so at
fontSize 100 one unit is 0.1 px.
"""
import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTCollection
from fontTools.ttLib.tables.TupleVariation import TupleVariation

HERE = os.path.dirname(os.path.abspath(__file__))


def box(width, height=500, left=0):
    pen = TTGlyphPen(None)
    if width > 0:
        pen.moveTo((left, 0))
        pen.lineTo((left, height))
        pen.lineTo((left + width, height))
        pen.lineTo((left + width, 0))
        pen.closePath()
    return pen.glyph()


def build(family, style, weight, italic, glyphs, cmap, features=None, axes=None, variations=None):
    """glyphs: name -> (advance, ink width); cmap: char -> name."""
    names = [".notdef"] + list(glyphs)
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({ord(c): g for c, g in cmap.items()})
    shapes = {".notdef": box(400, 700, 50)}
    metrics = {".notdef": (500, 50)}
    for name, (advance, ink) in glyphs.items():
        shapes[name] = box(ink)
        metrics[name] = (advance, 0)
    fb.setupGlyf(shapes)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": family, "styleName": style, "uniqueFontIdentifier": f"{family} {style}",
                       "fullName": f"{family} {style}", "psName": (family + "-" + style).replace(" ", "")})
    fb.setupOS2(usWeightClass=weight, fsSelection=(0x01 if italic else 0x40), sTypoAscender=800, sTypoDescender=-200,
                usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    fb.font["head"].macStyle = (0x02 if italic else 0) | (0x01 if weight >= 700 else 0)
    if axes:
        fb.setupFvar(axes, [])
        fb.setupGvar(variations)
    if features:
        addOpenTypeFeaturesFromString(fb.font, features)
    return fb.font


LATIN = {"x": (500, 500), "i": (200, 100), "f": (300, 200), "f_f": (400, 300), "zero": (600, 500), "one": (300, 200),
         "one.tnum": (600, 200), "space": (250, 0)}
LATIN_CMAP = {"x": "x", "i": "i", "f": "f", "0": "zero", "1": "one", " ": "space"}
FEATURES = """
languagesystem DFLT dflt;
feature liga { sub f f by f_f; } liga;
feature tnum { sub one by one.tnum; } tnum;
"""


def save(font, name):
    font.save(os.path.join(HERE, name))


# NB Test: regular, bold (x is 700 wide) and italic (x is 600 wide); no bold italic.
save(build("NB Test", "Regular", 400, False, LATIN, LATIN_CMAP, FEATURES), "NBTest-Regular.ttf")
save(build("NB Test", "Bold", 700, False, {**LATIN, "x": (700, 700)}, LATIN_CMAP, FEATURES), "NBTest-Bold.ttf")
save(build("NB Test", "Italic", 400, True, {**LATIN, "x": (600, 600)}, LATIN_CMAP, FEATURES), "NBTest-Italic.ttf")

# NB Fallback: only "z" (900 wide) and "x" (100 wide), regular only.
fallback = build("NB Fallback", "Regular", 400, False, {"z": (900, 900), "x": (100, 100)}, {"z": "z", "x": "x"})
save(fallback, "NBFallback-Regular.ttf")
fallback.flavor = "woff"
save(fallback, "NBFallback-Regular.woff")
fallback.flavor = "woff2"
save(fallback, "NBFallback-Regular.woff2")

# The same font with CFF outlines (.otf).
def build_cff(family, glyphs, cmap):
    from fontTools.pens.t2CharStringPen import T2CharStringPen
    names = [".notdef"] + list(glyphs)
    fb = FontBuilder(1000, isTTF=False)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({ord(c): g for c, g in cmap.items()})
    charstrings, metrics = {}, {}
    for name, (advance, ink) in {".notdef": (500, 400), **glyphs}.items():
        pen = T2CharStringPen(advance, None)
        pen.moveTo((0, 0)); pen.lineTo((0, 500)); pen.lineTo((ink, 500)); pen.lineTo((ink, 0)); pen.closePath()
        charstrings[name] = pen.getCharString()
        metrics[name] = (advance, 0)
    ps = family.replace(" ", "") + "-Regular"
    fb.setupCFF(ps, {"FullName": family}, charstrings, {})
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": family, "styleName": "Regular"})
    fb.setupOS2(usWeightClass=400, sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    return fb.font


save(build_cff("NB Fallback", {"z": (900, 900), "x": (100, 100)}, {"z": "z", "x": "x"}), "NBFallback-Regular.otf")


# NB Var: wght 100..900 (default 400) and wdth 50..100 (default 100). "x" is 500 wide at the
# default, 900 at wght 900, 300 at wght 100, and 250 narrower at wdth 50. Points: the box's four
# corners, then the four phantom points (the second one is the advance).
def x_deltas(dx):
    return [(0, 0), (0, 0), (dx, 0), (dx, 0), (0, 0), (dx, 0), (0, 0), (0, 0)]


var = build("NB Var", "Regular", 400, False, {"x": (500, 500), "space": (250, 0)}, {"x": "x", " ": "space"},
            axes=[("wght", 100, 400, 900, "Weight"), ("wdth", 50, 100, 100, "Width")],
            variations={"x": [TupleVariation({"wght": (0, 1, 1)}, x_deltas(400)),
                              TupleVariation({"wght": (-1, -1, 0)}, x_deltas(-200)),
                              TupleVariation({"wdth": (-1, -1, 0)}, x_deltas(-250))],
                        "space": []})
save(var, "NBVar.ttf")

# A collection: NB Test Regular and NB Fallback in one file.
collection = TTCollection()
from fontTools.ttLib import TTFont
collection.fonts = [TTFont(os.path.join(HERE, "NBTest-Regular.ttf")), TTFont(os.path.join(HERE, "NBFallback-Regular.ttf"))]
collection.save(os.path.join(HERE, "NBCollection.ttc"))
