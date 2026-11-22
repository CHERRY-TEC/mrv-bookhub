from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3000)

    page.evaluate("() => { window.__bookTurn = null; window.__turnPivot = null; }")
    page.mouse.wheel(0, 200)
    for i in range(8):
        st = page.evaluate("""() => {
          const s = window.__bookTurn;
          const o = window.__turnPivot;
          if (!o) return {s, o:null};
          return {s, vis:o.visible, rotY:o.rotation.y, posZ:o.position.z,
                  children:o.children.length,
                  geoCount:o.children[0]?.geometry?.attributes?.position?.count};
        }""")
        print(i, st)
        page.wait_for_timeout(30)
    b.close()
