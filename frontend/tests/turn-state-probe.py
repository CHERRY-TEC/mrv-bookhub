from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3000)
    page.evaluate("() => { window.__bookTurn = null; }")
    page.mouse.wheel(0, 200)
    for i in range(14):
        st = page.evaluate("() => window.__bookTurn")
        if st: print(f"frame {i}: p={st['p']:.2f} e={st['e']:.2f} mid={st['mid']:.2f} dir={st['dir']}")
        page.wait_for_timeout(60)
    b.close()
