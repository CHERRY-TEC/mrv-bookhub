from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3000)
    for i in range(6):
        page.mouse.wheel(0, 200); page.wait_for_timeout(700)
    page.wait_for_timeout(2000)
    st = page.evaluate("""() => {
      const plane = document.querySelector('canvas');
      // find R3F root via canvas __r3f
      const root = plane.__r3f?.root?.getState?.() || window.__r3f;
      return { hasRoot: !!root };
    }""")
    print(st)
    b.close()
