"""Capture the premium UI makeover."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(4000)
    page.screenshot(path="tests/screenshots/ui-hero.png")

    # login modal
    page.get_by_role("button", name="Sign in").first.click()
    page.wait_for_timeout(600)
    page.screenshot(path="tests/screenshots/ui-modal.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    # book panel
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3000)
    page.screenshot(path="tests/screenshots/ui-book.png")
    print("errors:", errs[:2] or "none")
    b.close()
