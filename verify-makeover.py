from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    r = page.goto("https://mrv-deploy.vercel.app", wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(4000)
    font = page.evaluate("() => getComputedStyle(document.querySelector('h1')).fontFamily")
    print("HTTP:", r.status)
    print("h1 font:", font[:60])
    print("errors:", errs[:2] or "none")
    page.screenshot(path="live-makeover.png")
    b.close()
