from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.add_init_script("""
      window.addEventListener('error', (e) => {
        console.log('ERRMSG:', e.message);
      });
    """)
    page.on("console", lambda m: print("CONSOLE:", m.text[:200]) if "ERRMSG" in m.text else None)
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(1000)
    page.mouse.move(975, 425)
    page.wait_for_timeout(300)
    page.mouse.click(975, 425)
    page.wait_for_timeout(2500)
    # print any R3F warnings about disposed objects
    print("done")
    b.close()
