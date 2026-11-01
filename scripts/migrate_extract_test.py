import unittest
from migrate_extract import Grid, column


class CoordinateTests(unittest.TestCase):
    def test_merged_cells_keep_independent_excel_coordinates(self):
        parser = Grid()
        parser.feed('<table><thead><tr><th>ignore</th></tr></thead><tbody>'
                    '<tr><th id="0R6">7</th><td colspan="2">first ledger</td><td rowspan="2">shared</td><td>amount</td></tr>'
                    '<tr><th id="0R7">8</th><td>date</td><td>note<br>original</td><td>500৳</td></tr>'
                    '</tbody></table>')
        cells = {f'{column(col)}{row}': value for (row, col), value in parser.cells.items()}
        self.assertEqual(cells, {'A7': 'first ledger', 'C7': 'shared', 'D7': 'amount', 'A8': 'date', 'B8': 'note\noriginal', 'D8': '500৳'})


if __name__ == '__main__':
    unittest.main()
