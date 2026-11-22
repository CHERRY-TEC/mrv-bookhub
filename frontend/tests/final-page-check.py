"""Scroll to the last page and verify it settles cleanly (no grid, no mirror)."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3000)
    for i in range(6):
        page.mouse.wheel(0, 200)
        page.wait_for_timeout(700)
    page.wait_for_timeout(2000)  # let the last flip fully settle
    counter = page.locator(".page-counter").inner_text() if page.locator(".page-counter").count() else "?"
    print("counter:", counter)
    page.screenshot(path="tests/screenshots/final-page.png")
    print("errors:", errs[:2] or "none")
    b.close()
