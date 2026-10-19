"""Inventory helpers."""


def parse_price(text):
    """Parse a price string like "$12.50" or "1,234.50" into a float."""
    cleaned = text.strip().lstrip("$")
    if "," in cleaned:
        # European style decimal comma: "12,50"
        cleaned = cleaned.replace(",", ".")
    return float(cleaned)


def total_value(items):
    """Sum price * quantity for (price_text, quantity) pairs."""
    return round(sum(parse_price(p) * q for p, q in items), 2)
