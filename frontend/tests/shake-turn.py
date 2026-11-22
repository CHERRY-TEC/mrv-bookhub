"""Compare book framing before vs after a page turn (should be nearly identical)."""
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

    before = Image.open(io.BytesIO(page.screenshot())).crop((300, 150, 1050, 700)).convert('RGB')
    page.mouse.wheel(0, 200)
    page.wait_for_timeout(2200)   # flip fully settles
    after = Image.open(io.BytesIO(page.screenshot())).crop((300, 150, 1050, 700)).convert('RGB')
    d = ImageChops.difference(before, after)
    hist = d.histogram()
    mad = sum(i * v for i, v in enumerate(hist[:256])) / (before.width * before.height)
    print("before/after-turn MAD:", round(mad, 3), "(content changes between pages, so >0 expected)")
    # The stable gutter area should barely move
    gutter_before = before.crop((360, 250, 420, 500))
    gutter_after = after.crop((360, 250, 420, 500))
    gd = ImageChops.difference(gutter_before, gutter_after)
    gh = gd.histogram()
    gmad = sum(i * v for i, v in enumerate(gh[:256])) / (60 * 250)
    print("gutter-region MAD:", round(gmad, 3), "(low = no shake)")
    b.close()
