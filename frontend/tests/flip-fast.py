"""Very fast capture right after wheel to catch the flip in motion."""
import os
from playwright.sync_api import sync_playwright

OUT = "tests/screenshots"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(2800)
    for i in range(6):
        page.mouse.wheel(0, 200)
        page.screenshot(path=f"{OUT}/flip-fast-{i}.png")
        page.wait_for_timeout(60)
    b.close()
