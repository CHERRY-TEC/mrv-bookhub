"""Verify page turning on the live Vercel deployment."""
from playwright.sync_api import sync_playwright

URL = "https://mrv-deploy.vercel.app"
fails = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    resp = page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(4000)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(2800)
    page.mouse.wheel(0, 200); page.wait_for_timeout(900)
    page.screenshot(path="live-pageturn.png")
    body = page.inner_text("body")
    print("HTTP:", resp.status if resp else "none")
    print("panel:", "put the book back" in body.lower())
    print("errors:", errors[:2] or "none")
    for name, ok in [
        ("HTTP 200", resp is not None and resp.status == 200),
        ("panel", "put the book back" in body.lower()),
        ("no errors", not errors),
    ]:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}")
        if not ok: fails.append(name)
    b.close()
raise SystemExit(1 if fails else 0)
