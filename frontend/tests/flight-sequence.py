"""Dense capture after click to catch the cover-faces-you beat."""
import os
from playwright.sync_api import sync_playwright

OUT = "tests/screenshots"
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("pageerror", lambda e: print("PAGEERROR:", e))

    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(1200)

    page.mouse.move(975, 425)
    page.wait_for_timeout(400)
    page.mouse.click(975, 425)

    prev = 0
    for ms in (500, 1000, 1500, 2000, 2600, 3400, 4500):
        page.wait_for_timeout(ms - prev)
        prev = ms
        page.screenshot(path=f"{OUT}/beat-{ms:04d}.png")
        print(f"captured nominal {ms}ms")

    browser.close()
