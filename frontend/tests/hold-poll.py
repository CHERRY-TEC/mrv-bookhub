"""Poll hold state after a click to find what releases the book."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda m: print("CONSOLE:", m.text))
    page.on("pageerror", lambda e: print("PAGEERROR:", e))

    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(1200)

    page.mouse.move(975, 425)
    page.wait_for_timeout(400)
    page.mouse.click(975, 425)

    for i in range(24):
        state = page.evaluate(
            """() => ({
                held: document.querySelector('.app').className.includes('book-held'),
                panel: !!document.querySelector('.book-panel'),
            })"""
        )
        print(f"t={i*250:5d}ms held={state['held']} panel={state['panel']}")
        page.wait_for_timeout(250)

    browser.close()
