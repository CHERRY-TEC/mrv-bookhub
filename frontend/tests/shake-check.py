"""Measure frame-to-frame pixel motion of the open spread during a page turn."""
import io
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3200)

    # settle first: compare two frames with no interaction (breathing only)
    a = Image.open(io.BytesIO(page.screenshot())).crop((300, 150, 1050, 700))
    page.wait_for_timeout(120)
    c = Image.open(io.BytesIO(page.screenshot())).crop((300, 150, 1050, 700))
    d = ImageChops.difference(a.convert('RGB'), c.convert('RGB'))
    hist = d.histogram()
    # mean abs difference per channel
    mad = sum(i * v for i, v in enumerate(hist[:256])) / (a.width * a.height)
    print("idle frame MAD:", round(mad, 3))
    b.close()
