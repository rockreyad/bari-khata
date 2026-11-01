from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re


class Grid(HTMLParser):
    def __init__(self):
        super().__init__()
        self.cells = {}
        self.occupied = set()
        self.in_body = False
        self.row = None
        self.col = 1
        self.cell = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "tbody":
            self.in_body = True
        elif tag == "tr" and self.in_body:
            self.row = None
            self.col = 1
        elif tag == "th" and self.in_body:
            match = re.search(r"R(\d+)$", attrs.get("id", ""))
            if match:
                self.row = int(match.group(1)) + 1
        elif tag == "td" and self.in_body and self.row:
            while (self.row, self.col) in self.occupied:
                self.col += 1
            self.cell = {"row": self.row, "col": self.col, "text": [], "colspan": int(attrs.get("colspan", 1)), "rowspan": int(attrs.get("rowspan", 1))}
        elif tag == "br" and self.cell:
            self.cell["text"].append("\n")

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"].append(data)

    def handle_endtag(self, tag):
        if tag == "td" and self.cell is not None:
            cell = self.cell
            value = "".join(cell["text"]).strip()
            self.cells[(cell["row"], cell["col"])] = value
            for row in range(cell["row"], cell["row"] + cell["rowspan"]):
                for col in range(cell["col"], cell["col"] + cell["colspan"]):
                    self.occupied.add((row, col))
            self.col += cell["colspan"]
            self.cell = None
        elif tag == "tbody":
            self.in_body = False


def column(number):
    result = ""
    while number:
        number, rem = divmod(number - 1, 26)
        result = chr(65 + rem) + result
    return result


def extract(source, output):
    files = {}
    for filename in ["Home Construstion.html", "TOTAL HOME COST.html"]:
        path = source / filename
        content = path.read_bytes()
        parser = Grid()
        parser.feed(content.decode("utf-8"))
        files[filename] = {"checksum": hashlib.sha256(content).hexdigest(), "cells": {f"{column(col)}{row}": text for (row, col), text in parser.cells.items() if text}}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(files, ensure_ascii=False, indent=2))
    return files


if __name__ == "__main__":
    import argparse
    cli = argparse.ArgumentParser()
    cli.add_argument("--source", default="/Users/rockreyad/Downloads/Personal Wallet")
    cli.add_argument("--output", default="private/migration/source-grid.json")
    args = cli.parse_args()
    result = extract(Path(args.source), Path(args.output))
    print(json.dumps({name: {"cells": len(sheet["cells"]), "checksum": sheet["checksum"]} for name, sheet in result.items()}))
