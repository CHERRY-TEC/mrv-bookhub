"""Verify the live Vercel deployment loads with no errors."""
import sys
from playwright.sync_api import sync_playwright

URL = "https://mrv-deploy.vercel.app"
fails = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    resp = page.goto(URL, wait_until="networkidle", timeout=60000)
    print("HTTP", resp.status if resp else "no response")
    page.wait_for_timeout(4500)

    title = page.title()
    body = page.inner_text("body")
    has_canvas = page.locator("canvas").count() > 0
    has_nav = "MRV BookHub" in body

    print("title:", title)
    print("canvas:", has_canvas)
    print("nav:", has_nav)
    print("page errors:", errors[:3] or "none")

    page.screenshot(path="deploy-live.png")
    checks = {
        "HTTP 200": resp is not None and resp.status == 200,
        "3D canvas": has_canvas,
        "navigation": has_nav,
        "no page errors": not errors,
    }
    for name, ok in checks.items():
        print(f"[{'PASS' if ok else 'FAIL'}] {name}")
        if not ok:
            fails.append(name)
    browser.close()

sys.exit(1 if fails else 0)
