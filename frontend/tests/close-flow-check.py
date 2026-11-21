"""Esc closes the held book and restores the page copy."""
import sys
from playwright.sync_api import sync_playwright

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
    page.wait_for_timeout(2500)

    held = page.evaluate("() => document.querySelector('.app').className.includes('book-held')")
    check("book held after click", held)

    page.keyboard.press("Escape")
    page.wait_for_timeout(1500)

    state = page.evaluate(
        """() => ({
            held: document.querySelector('.app').className.includes('book-held'),
            panel: !!document.querySelector('.book-panel'),
            heroOpacity: getComputedStyle(document.querySelector('.scroll-content')).opacity,
        })"""
    )
    check("Esc releases the book", not state["held"], str(state))
    check("panel closed", not state["panel"])
    check("page copy restored", float(state["heroOpacity"]) > 0.9, state["heroOpacity"])
    check("no page errors", not errors, "; ".join(errors[:3]))
    browser.close()

print()
if fails:
    print(f"FAILED: {', '.join(fails)}")
    sys.exit(1)
print("OK")
