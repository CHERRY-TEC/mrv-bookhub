"""Capture a page mid-roll: poll screenshots rapidly after a wheel turn."""
import os
from PIL import Image, ImageChops
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

    before = page.screenshot()
    page.mouse.wheel(0, 200)
    for i in range(6):
        shot = page.screenshot(path=f"{OUT}/roll-{i}.png")
        # difference from the settled spread tells us the leaf is drawn
        a = Image.open(__import__('io').BytesIO(before)).crop((250, 150, 1050, 680))
        c = Image.open(__import__('io').BytesIO(shot)).crop((250, 150, 1050, 680))
        diff = ImageChops.difference(a.convert('RGB'), c.convert('RGB'))
        bbox = diff.getbbox()
        print(f"frame {i}: diff bbox={bbox}")
        page.wait_for_timeout(40)
    print("errors:", errs[:2] or "none")
    b.close()
