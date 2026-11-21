"""Visual verification of the MRV BookHub 3D frontend.

Run with:
  python tests/visual-check.py
(Backend on :5000 and `npm run dev` on :5173 must already be running.)
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
OUT = "tests/screenshots"

import os
os.makedirs(OUT, exist_ok=True)

failures = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader", "--enable-webgl"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    console_errors = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append(str(e)))

    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(3000)  # let R3F render first frames

    # 1. Canvas exists and WebGL context is live
    canvas = page.locator("canvas")
    check("canvas rendered", canvas.count() >= 1)
    page.screenshot(path=f"{OUT}/01-initial-shelf.png")

    # 2. Title / HUD overlay
    body_text = page.inner_text("body")
    check("HUD title visible", "MRV" in body_text or "BookHub" in body_text, body_text[:200])

    # 3. Books loaded from API into the scene (HUD counter or book list)
    page.wait_for_timeout(2000)
    page.screenshot(path=f"{OUT}/02-books-loaded.png")

    # 4. Scroll drives the camera along the shelf
    page.mouse.wheel(0, 1200)
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/03-scrolled.png")

    # 5. Click a book: search for an interactable overlay/cursor hint.
    #    R3F meshes aren't DOM elements, so click near the center-left of the
    #    shelf area where a book should be at initial scroll position.
    page.mouse.wheel(0, -1500)
    page.wait_for_timeout(1200)
    page.mouse.move(620, 430)
    page.wait_for_timeout(600)  # hover highlight / pointer cursor
    page.screenshot(path=f"{OUT}/04-hover.png")
    page.mouse.click(620, 430)
    page.wait_for_timeout(2500)  # flight + open animation
    page.screenshot(path=f"{OUT}/05-after-click.png")

    # 6. Book detail panel opened (DOM overlay after selection)
    panel_text = page.inner_text("body")
    check("book panel or login prompt appears after click",
          any(k in panel_text for k in ("Borrow", "Reserve", "Sign in", "Login", "Log in", "Details")),
          panel_text[:300])

    # 7. Console errors (ignore favicon / dev noise)
    real_errors = [e for e in console_errors if "favicon" not in e.lower()]
    check("no console/page errors", not real_errors, "; ".join(real_errors[:3]))

    browser.close()

print()
if failures:
    print(f"{len(failures)} check(s) FAILED: {', '.join(failures)}")
    sys.exit(1)
print("All visual checks passed.")
