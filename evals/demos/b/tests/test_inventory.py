import unittest

from inventory import parse_price, total_value


class ParsePriceTest(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(parse_price("12.50"), 12.5)

    def test_dollar(self):
        self.assertEqual(parse_price("$3"), 3.0)

    def test_decimal_comma(self):
        self.assertEqual(parse_price("12,50"), 12.5)


class TotalValueTest(unittest.TestCase):
    def test_total(self):
        self.assertEqual(total_value([("2.00", 3), ("$1.25", 2)]), 8.5)


if __name__ == "__main__":
    unittest.main()
