"""Verify the live frontend is talking to the live API (full stack)."""
import sys
from playwright.sync_api import sync_playwright

URL = "https://mrv-deploy.vercel.app"
fails = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    resp = page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(4500)

    body = page.inner_text("body")
    demo_toast = "demo shelf" in body.lower() or "backend unreachable" in body.lower()
    print("HTTP:", resp.status if resp else "none")
    print("demo-shelf toast:", demo_toast)
    print("page errors:", errors[:2] or "none")

    # Sign in with seeded account through the UI
    page.get_by_role("button", name="Sign in").first.click()
    page.wait_for_timeout(500)
    # modal: choose student (default) and fill hall ticket + password
    inputs = page.locator("input")
    print("inputs found:", inputs.count())
    if inputs.count() >= 2:
        inputs.nth(0).fill("22B81A0501")
        inputs.nth(1).fill("Student@123")
        page.get_by_role("button", name="Sign in").last.click()
        page.wait_for_timeout(2500)
    body2 = page.inner_text("body")
    logged_in = "Welcome" in body2 or "Sign out" in body2 or "Sign in" not in body2
    print("logged in:", logged_in)

    checks = [
        ("HTTP 200", resp is not None and resp.status == 200),
        ("no demo toast", not demo_toast),
        ("no page errors", not errors),
        ("login worked", logged_in),
    ]
    for name, ok in checks:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}")
        if not ok: fails.append(name)
    page.screenshot(path="live-fullstack.png")
    b.close()
raise SystemExit(1 if fails else 0)
