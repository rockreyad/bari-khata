import argparse
from io import BytesIO
from pathlib import Path

from fontTools.ttLib import TTFont


FACES = {
    "FN Mahin Rafid/FN Mahin Rafid Regular.ttf": "fn-mahin-rafid-regular.woff2",
    "FN Mahin Rafid/FN Mahin Rafid Italic.ttf": "fn-mahin-rafid-italic.woff2",
    "FN Mahin Rafid Book/FN Mahin Rafid Book Regular.ttf": "fn-mahin-rafid-book-regular.woff2",
    "FN Mahin Rafid Book/FN Mahin Rafid Book Italic.ttf": "fn-mahin-rafid-book-italic.woff2",
}


def convert(source: Path, destination: Path):
    with TTFont(source, recalcTimestamp=False) as original:
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
        destination.write_bytes(encoded)
        print(f"{destination.name}: {source.stat().st_size:,} → {len(encoded):,} bytes")


def main():
    parser = argparse.ArgumentParser(description="মূল TTF অক্ষত রেখে WOFF2 তৈরি করুন।")
    parser.add_argument("source", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1]
        / "src/assets/fonts/fn-mahin-rafid",
    )
    args = parser.parse_args()
    for relative in FACES:
        if not (args.source / relative).is_file():
            parser.error(f"ফাইল পাওয়া যায়নি: {args.source / relative}")
    args.output.mkdir(parents=True, exist_ok=True)
    for relative, name in FACES.items():
        convert(args.source / relative, args.output / name)


if __name__ == "__main__":
    main()
