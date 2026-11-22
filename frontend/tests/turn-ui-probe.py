from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3000)
    print("before:", "to turn the pages" in page.inner_text("body").lower(),
          "counter:", page.locator(".page-counter").inner_text() if page.locator(".page-counter").count() else None)
    page.keyboard.press("ArrowRight")
    for i in range(8):
        page.wait_for_timeout(400)
        hint = "to turn the pages" in page.inner_text("body").lower()
        cnt = page.locator(".page-counter").inner_text() if page.locator(".page-counter").count() else None
        print(i, "hint:", hint, "counter:", cnt)
    b.close()
