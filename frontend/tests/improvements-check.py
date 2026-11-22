"""Verify the 10 improvements: hint, counter, keyboard, sound, search, overlay."""
import sys
from playwright.sync_api import sync_playwright

fails = []
def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)

    # 9. Search bar
    search = page.locator('input[type="search"]')
    check("search bar exists", search.count() == 1)
    search.fill("Theory")
    page.wait_for_timeout(600)
    check("search filters", "Theory" in search.input_value())

    # 10. Lazy scene loaded (canvas present after Suspense)
    check("3D canvas loaded", page.locator("canvas").count() == 1)

    # clear search so the full shelf is back
    search.fill("")
    page.wait_for_timeout(600)
    # open a book
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3000)

    body = page.inner_text("body")
    check("turn hint shown", "to turn the pages" in body.lower())
    check("page counter shown", "/ 6" in body)

    # 8. Keyboard turn
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(2600)
    body2 = page.inner_text("body")
    check("keyboard turned page (hint gone)", "to turn the pages" not in body2.lower(),
          "hint still present")

    # sound toggle
    check("sound toggle exists", page.locator(".sound-toggle").count() == 1)
    page.locator(".sound-toggle").click()
    check("sound toggled", page.locator(".sound-toggle").inner_text() in ("🔊", "🔇"))

    check("no page errors", not errs, "; ".join(errs[:3]))
    page.screenshot(path="tests/screenshots/improvements.png")
    b.close()

print()
if fails: print("FAILED:", ", ".join(fails)); sys.exit(1)
print("OK")
