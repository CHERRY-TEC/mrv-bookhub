from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.on("pageerror", lambda e: print("PAGEERROR:", e.stack or str(e)))
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(1000)
    page.mouse.move(975, 425)
    page.wait_for_timeout(300)
    page.mouse.click(975, 425)
    page.wait_for_timeout(2500)
    page.mouse.wheel(0, 200)
    page.wait_for_timeout(1000)
    b.close()
