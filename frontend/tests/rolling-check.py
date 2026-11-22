"""Capture the rolling page-flip at several points during one turn."""
import os
from playwright.sync_api import sync_playwright

OUT = "tests/screenshots"
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

    # one scroll = one flip; capture across its ~0.62s duration
    page.mouse.wheel(0, 200)
    for ms in (60, 160, 300, 460, 700):
        page.wait_for_timeout(ms if ms == 60 else ms - prev)
        prev = ms
        page.screenshot(path=f"{OUT}/roll-{ms:03d}.png")
    print("errors:", errs[:2] or "none")
    b.close()
