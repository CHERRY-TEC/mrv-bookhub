"""Capture a page mid-flip to verify the curved turn animation."""
import os
from playwright.sync_api import sync_playwright

OUT = "tests/screenshots"
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425)
    page.wait_for_timeout(2800)

    for i, ms in enumerate((120, 260, 420, 700)):
        page.mouse.wheel(0, 200)
        page.wait_for_timeout(ms)
        page.screenshot(path=f"{OUT}/midflip-{i}.png")

    print("errors:", errors[:2] or "none")
    b.close()
