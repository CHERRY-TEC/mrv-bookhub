from playwright.sync_api import sync_playwright

URL = "https://mrv-deploy.vercel.app"
fails = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    resp = page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(4000)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3000)
    for i in range(6):
        page.mouse.wheel(0, 200); page.wait_for_timeout(700)
    page.wait_for_timeout(2000)
    counter = page.locator(".page-counter").inner_text() if page.locator(".page-counter").count() else "?"
    print("HTTP:", resp.status, "counter:", counter, "errors:", errs[:2] or "none")
    page.screenshot(path="live-final-page.png")
    ok = resp.status == 200 and counter.strip().startswith("6") and not errs
    print("[PASS]" if ok else "[FAIL] live final page")
    b.close()
    raise SystemExit(0 if ok else 1)
