import json, urllib.request, urllib.error

BASE = "https://mrv-bookhub-api.vercel.app/api"

def call(path, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

health = call("/health")
print("HEALTH:", health[0], health[1].get("message"))
books = call("/books?limit=5&availability=available")
print("BOOKS:", books[0], "count:", len(books[1].get("data", {}).get("books", [])),
      "first:", (books[1].get("data", {}).get("books") or [{}])[0].get("title"))
login = call("/auth/login/student", "POST", {"hall_ticket_number": "22B81A0501", "password": "Student@123"})
print("LOGIN:", login[0], login[1].get("message"))
if login[0] == 200:
    tok = login[1]["data"]["token"]
    me = call("/auth/me", token=tok)
    print("ME:", me[0], me[1].get("data", {}).get("user", {}).get("full_name"))
