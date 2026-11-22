from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173", wait_until="networkidle")
    page.wait_for_timeout(3500)
    page.mouse.wheel(0, 400); page.wait_for_timeout(1200)
    page.mouse.move(975, 425); page.wait_for_timeout(400)
    page.mouse.click(975, 425); page.wait_for_timeout(3000)
    page.mouse.wheel(0, 200); page.wait_for_timeout(180)
    info = page.evaluate("""() => {
      const o = window.__turnPivot;
      const g = o.children[0];
      const a = g.geometry.attributes.position.array;
      const xs=[], ys=[], zs=[];
      for(let i=0;i<a.length;i+=3){xs.push(a[i]);ys.push(a[i+1]);zs.push(a[i+2]);}
      return {x:[Math.min(...xs),Math.max(...xs)], y:[Math.min(...ys),Math.max(...ys)],
              z:[Math.min(...zs),Math.max(...zs)],
              geoParams:g.geometry.parameters,
              scale:[o.scale.x,o.scale.y,o.scale.z],
              parentScale:[o.parent.scale.x,o.parent.scale.x],
              onBeforeRender: !!g.onBeforeRender,
              layers:o.layers.mask,
              camLayers: window.__camLayers || null};
    }""")
    print(info)
    b.close()
