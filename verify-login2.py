from playwright.sync_api import sync_playwright

URL = "https://mrv-deploy.vercel.app"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    resp = page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(4000)
    print("search box:", page.locator('input[type="search"]').count())
    page.get_by_role("button", name="Sign in").first.click()
    page.wait_for_timeout(500)
    modal = page.locator(".modal")
    inputs = modal.locator("input")
    print("modal inputs:", inputs.count())
    inputs.nth(0).fill("22B81A0501")
    inputs.nth(1).fill("Student@123")
    modal.get_by_role("button", name="Sign in").click()
    page.wait_for_timeout(2500)
    body = page.inner_text("body")
    print("welcome:", "Welcome" in body, "notif:", "🔔" in body)
    print("errors:", errs[:2] or "none")
    b.close()
