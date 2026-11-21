"""Verify click -> book flies to hands -> detail panel opens."""
import sys, os
from playwright.sync_api import sync_playwright

OUT = "tests/screenshots"
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)

    # Scroll a little so the hero card is out of the way and books are centered
    page.mouse.wheel(0, 600)
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/10-before-pick.png")

    # Click a visible book spine on the middle shelf (right of hero card zone)
    page.mouse.move(950, 430)
    page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/11-hover-book.png")
    page.mouse.click(950, 430)
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{OUT}/12-flying.png")
    page.wait_for_timeout(2500)
    page.screenshot(path=f"{OUT}/13-open-in-hands.png")

    text = page.inner_text("body")
    # Detail panel should mention an action or book metadata
    ok = any(k in text for k in ("Borrow", "Reserve", "Order", "Add to", "due", "owner", "Owner"))
    print("PANEL-TEXT:", "FOUND" if ok else "MISSING")
    print("PAGE ERRORS:", errors if errors else "none")
    browser.close()
    sys.exit(0 if ok else 1)
