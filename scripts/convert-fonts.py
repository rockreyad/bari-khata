import argparse
from hashlib import sha256
from io import BytesIO
from pathlib import Path

from fontTools import subset
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable


FACES = {
    "Unicode/Akkhor Regular.ttf": "fn-akkhor-regular.woff2",
    "Unicode/Akkhor italic.ttf": "fn-akkhor-italic.woff2",
}


def narrow_space(font):
    glyph_name = "uni202F"
    if glyph_name not in font.getGlyphOrder():
        font.setGlyphOrder([*font.getGlyphOrder(), glyph_name])
        font["glyf"][glyph_name] = TTGlyphPen(None).glyph()
    font["hmtx"].metrics[glyph_name] = (round(font["head"].unitsPerEm / 8), 0)
    for table in font["cmap"].tables:
        if table.isUnicode() and hasattr(table, "cmap"):
            table.cmap[0x202F] = glyph_name


def glyph_snapshot(font, codepoint):
    glyph_name = font.getBestCmap()[codepoint]
    glyphs = font.getGlyphSet()
    pen = DecomposingRecordingPen(glyphs)
    glyphs[glyph_name].draw(pen)
    return font["hmtx"].metrics[glyph_name], pen.value


def convert(source: Path, destination: Path, *, numeric=False, currency_only=False):
    with TTFont(source, recalcTimestamp=False) as original:
        positioning = original.reader["GPOS"] if "GPOS" in original else b""
        if sha256(positioning).hexdigest() == (
            "c716f725b977996fafdd187662dc1967fafdebf2382dcf0e11cd1a1eda13f7f3"
        ):
            # এই নির্দিষ্ট Akkhor ফাইলের শেষ empty ClassDef1-এ চার byte নেই।
            repaired = newTable("GPOS")
            repaired.decompile(positioning + b"\0" * 4, original)
            original["GPOS"] = repaired
            print(f"{source.name}: অসম্পূর্ণ ClassDef1 ঠিক করা হয়েছে।")
        currency = glyph_snapshot(original, 0x09F3) if currency_only else None
        if numeric or currency_only:
            narrow_space(original)
        if currency_only:
            options = subset.Options()
            options.glyph_names = True
            options.name_IDs = ["*"]
            options.name_legacy = True
            options.notdef_outline = True
            subsetter = subset.Subsetter(options=options)
            subsetter.populate(unicodes=[0x09F3, 0x202F])
            subsetter.subset(original)
            if glyph_snapshot(original, 0x09F3) != currency:
                raise ValueError("টাকার চিহ্নের নকশা বা মাপ বদলেছে।")
        original.flavor = "woff2"
        buffer = BytesIO()
        original.save(buffer)
        encoded = buffer.getvalue()
        with TTFont(BytesIO(encoded), recalcTimestamp=False) as restored:
            if (
                restored.flavor != "woff2"
                or original.getBestCmap() != restored.getBestCmap()
                or original.getGlyphOrder() != restored.getGlyphOrder()
                or original["hmtx"].metrics != restored["hmtx"].metrics
                or original["head"].unitsPerEm != restored["head"].unitsPerEm
            ):
                raise ValueError(f"রূপান্তরের পর অক্ষর বা মাপ মেলেনি: {source.name}")
            for table in ("GSUB", "GPOS", "GDEF"):
                if (table in original) != (table in restored) or (
                    table in original
                    and original[table].compile(original)
                    != restored[table].compile(restored)
                ):
                    raise ValueError(f"রূপান্তরের পর {table} মেলেনি: {source.name}")
            if currency_only and glyph_snapshot(restored, 0x09F3) != currency:
                raise ValueError("WOFF2-তে টাকার চিহ্নের নকশা বা মাপ বদলেছে।")
            if numeric or currency_only:
                space = restored.getBestCmap()[0x202F]
                if restored["hmtx"].metrics[space][0] != round(
                    restored["head"].unitsPerEm / 8
                ):
                    raise ValueError("ছোট ফাঁকের মাপ মেলেনি।")
        destination.write_bytes(encoded)
        print(f"{destination.name}: {source.stat().st_size:,} → {len(encoded):,} bytes")


def main():
    parser = argparse.ArgumentParser(description="মূল TTF অক্ষত রেখে WOFF2 তৈরি করুন।")
    parser.add_argument("source", type=Path)
    parser.add_argument(
        "--family", choices=["akkhor", "ekush", "hind-currency"], default="akkhor"
    )
    parser.add_argument(
        "--output",
        type=Path,
    )
    args = parser.parse_args()
    faces = (
        {"Ekush-Regular.ttf": "ekush-numerals-regular.woff2"}
        if args.family == "ekush"
        else {
            f"hind-siliguri-bengali-{weight}-normal.woff2": f"hind-currency-{weight}.woff2"
            for weight in (400, 500, 600, 700)
        }
        if args.family == "hind-currency"
        else FACES
    )
    output = args.output or (
        Path(__file__).resolve().parents[1]
        / "src/assets/fonts"
        / {
            "akkhor": "fn-akkhor",
            "ekush": "ekush",
            "hind-currency": "hind-currency",
        }[args.family]
    )
    for relative in faces:
        if not (args.source / relative).is_file():
            parser.error(f"ফাইল পাওয়া যায়নি: {args.source / relative}")
    output.mkdir(parents=True, exist_ok=True)
    for relative, name in faces.items():
        convert(
            args.source / relative,
            output / name,
            numeric=args.family == "ekush",
            currency_only=args.family == "hind-currency",
        )


if __name__ == "__main__":
    main()
