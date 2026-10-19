"""Tiny word counter CLI."""
import argparse
import sys


def count_words(text):
    return len(text.split())


def main(argv=None):
    parser = argparse.ArgumentParser(prog="wc.py")
    parser.add_argument("file")
    args = parser.parse_args(argv)
    with open(args.file, encoding="utf-8") as f:
        print(count_words(f.read()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
