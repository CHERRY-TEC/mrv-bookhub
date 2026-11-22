from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: print("C:", m.text[:150]) if "error" in m.text.lower() else None)
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3500)
    body = page.inner_text("body")
    print("ABOUT in body:", "ABOUT THIS BOOK" in body)
    print("errors:", errs[:2] or "none")
    page.screenshot(path="tests/screenshots/page1-check.png")
    b.close()
