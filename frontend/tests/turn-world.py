from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3000)
    page.mouse.wheel(0, 200)
    page.wait_for_timeout(180)
    info = page.evaluate("""() => {
      const o = window.__turnPivot;
      if (!o) return null;
      const v = new (o.position.constructor)();
      o.getWorldPosition(v);
      const g = o.children[0];
      const gb = g.geometry.boundingBox;
      return {
        world: [v.x, v.y, v.z],
        visible: o.visible,
        rot: [o.rotation.x, o.rotation.y, o.rotation.z],
        matType: g.material.type,
        matVisible: g.material.visible,
        op: g.material.opacity,
        parentVis: o.parent.visible,
        gpVis: o.parent.parent?.visible,
        gpName: o.parent.parent?.type,
        geoZmin: g.geometry.attributes.position.array.filter((_,i)=>i%3===2).reduce((a,b)=>Math.min(a,b),99),
        geoZmax: g.geometry.attributes.position.array.filter((_,i)=>i%3===2).reduce((a,b)=>Math.max(a,b),-99),
      };
    }""")
    print(info)
    b.close()
