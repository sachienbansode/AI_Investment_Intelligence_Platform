"""Create (or promote) an admin user interactively.

Run from the backend folder with the venv active:
    python scripts\\create_admin.py

Prompts for email and password — nothing is stored in files or shell history;
only the bcrypt hash goes into the database (whatever DATABASE_URL points to).
"""
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.auth import hash_password           # noqa: E402
from app.core.compliance import audit_log         # noqa: E402
from app.db.database import SessionLocal, User, init_db  # noqa: E402


def main() -> None:
    init_db()
    email = input("Admin email: ").strip().lower()
    if not email or "@" not in email:
        sys.exit("Invalid email.")
    password = getpass.getpass("Password (min 8 chars, not shown): ")
    if len(password) < 8:
        sys.exit("Password must be at least 8 characters.")
    if getpass.getpass("Confirm password: ") != password:
        sys.exit("Passwords do not match.")

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).first()
        if user:
            user.hashed_password = hash_password(password)
            user.is_admin = True
            user.is_active = True
            action = "updated & promoted to admin"
        else:
            user = User(email=email, full_name="Administrator",
                        hashed_password=hash_password(password), is_admin=True)
            db.add(user)
            action = "created as admin"
        db.commit()
    finally:
        db.close()
    audit_log("admin_cli_user", user=email, action=action)
    print(f"OK: {email} {action}.")


if __name__ == "__main__":
    main()
