from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda m: print("C:", m.text[:300]) if "BADMAT" in m.text else None)
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3000)

    # Hook Three's refreshTransformUniform by wrapping Matrix3.copy errors
    page.evaluate("""
      (() => {
        const proto = window.__THREE_MATRIX3__;
      })();
    """)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(1000)
    page.mouse.move(975, 425); page.wait_for_timeout(300)
    page.mouse.click(975, 425); page.wait_for_timeout(2500)
    b.close()
