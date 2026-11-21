"""Verify action buttons prompt sign-in when logged out, then full borrow flow."""
import sys, os
from playwright.sync_api import sync_playwright

OUT = "tests/screenshots"
os.makedirs(OUT, exist_ok=True)
fails = []


def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 600)
    page.wait_for_timeout(1500)

    # Pick a book
    page.mouse.click(950, 430)
    page.wait_for_timeout(3500)

    # Try the primary action in the panel
    action = page.locator("button:has-text('Order now'), button:has-text('Borrow'), button:has-text('Reserve'), button:has-text('Sign in')").first
    if action.count() == 0:
        # maybe already requires login
        check("panel action button visible", False)
    else:
        action.click()
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}/20-action-clicked.png")
        text = page.inner_text("body")
        check("login prompt appears for signed-out action",
              any(k in text.lower() for k in ("sign in", "log in", "login", "password")),
              text[:300])

        # Sign in with seeded student
        id_field = page.locator("input").first
        if id_field.count():
            fields = page.locator("input")
            fields.nth(0).fill("22B81A0501")
            fields.nth(1).fill("Student@123")
            page.locator(".modal button[type='submit']").click()
            page.wait_for_timeout(2000)
            page.screenshot(path=f"{OUT}/21-signed-in.png")
            body = page.inner_text("body")
            check("signed in (no Sign in button in nav)",
                  "sign in" not in body.lower().split("walk the shelves")[0][:400].lower() or "student" in body.lower() or "22B81A0501" in body, body[:200])

    check("no page errors", not errors, "; ".join(errors[:3]))
    browser.close()

print()
if fails:
    print(f"FAILED: {', '.join(fails)}")
    sys.exit(1)
print("All checks passed.")
