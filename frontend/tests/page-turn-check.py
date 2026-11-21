"""Verify scroll-driven page turning in the held book."""
import os, sys
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
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(1200)

    page.mouse.move(975, 425)
    page.wait_for_timeout(400)
    page.mouse.click(975, 425)
    page.wait_for_timeout(3000)
    page.screenshot(path=f"{OUT}/turn-0-closed.png")

    # Scroll through the pages (wheel is captured by the book while held)
    for step in range(1, 7):
        page.mouse.wheel(0, 200)
        page.wait_for_timeout(900)
        page.screenshot(path=f"{OUT}/turn-{step}.png")

    body = page.inner_text("body")
    check("detail panel still present", "put the book back" in body.lower())
    check("no page errors", not errors, "; ".join(errors[:3]))
    browser.close()

print()
if fails:
    print(f"FAILED: {', '.join(fails)}")
    sys.exit(1)
print("OK")
