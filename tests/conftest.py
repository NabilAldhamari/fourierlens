import os

# TestClient addresses the app as "testserver"; allow it before the app is imported.
os.environ.setdefault("FOURIERLENS_ALLOWED_HOSTS", "testserver")
