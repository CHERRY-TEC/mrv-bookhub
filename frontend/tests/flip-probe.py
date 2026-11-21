"""Probe the turning leaf's rotation over time via R3F scene traversal."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(2800)

    # expose scene via a global set in Book.jsx? fallback: check canvas pixel hash
    from PIL import Image
    import io
    hashes = []
    page.mouse.wheel(0, 200)
    for i in range(8):
        shot = page.screenshot()
        # simple hash of a crop around the book
        im = Image.open(io.BytesIO(shot)).crop((250, 150, 1050, 680))
        h = hash(im.tobytes())
        hashes.append(h)
        page.wait_for_timeout(80)
    print("distinct frames during one turn:", len(set(hashes)), "of", len(hashes))
    b.close()
