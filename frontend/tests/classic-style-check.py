"""Verify classic cover style + open-book detail pages."""
import sys, os
from playwright.sync_api import sync_playwright

OUT = "tests/screenshots"
os.makedirs(OUT, exist_ok=True)
fails = []


def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)

    # Shelf closeup: spines should have foil rules + vertical titles
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{OUT}/30-classic-shelf.png", clip={"x": 700, "y": 80, "width": 740, "height": 700})

    # Click a book on the right side (clear of hero card)
    page.mouse.move(975, 425)
    page.wait_for_timeout(500)
    page.mouse.click(975, 425)
    page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/31-cover-faces-you.png")
    page.wait_for_timeout(3500)
    page.screenshot(path=f"{OUT}/32-open-spread.png")

    body = page.inner_text("body")
    check("detail panel present", "put the book back" in body.lower())
    check("no page errors", not errors, "; ".join(errors[:3]))
    browser.close()

print()
if fails:
    print(f"FAILED: {', '.join(fails)}")
    sys.exit(1)
print("OK")
