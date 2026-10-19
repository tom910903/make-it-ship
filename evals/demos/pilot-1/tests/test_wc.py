import unittest

from wc import count_words


class CountWordsTest(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(count_words("a b  c\n d"), 4)


if __name__ == "__main__":
    unittest.main()
