import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

class Settings:
    # Oracle ADB Settings
    ORACLE_USER: str = os.getenv("ORACLE_USER", "").strip()
    ORACLE_PASSWORD: str = os.getenv("ORACLE_PASSWORD", "").strip()
    ORACLE_DSN: str = os.getenv("ORACLE_DSN", "").strip()
    ORACLE_WALLET_DIR: str = os.getenv("ORACLE_WALLET_DIR", "./wallet").strip()
    ORACLE_WALLET_PASSWORD: str = os.getenv("ORACLE_WALLET_PASSWORD", "").strip()

    # JWT & Security Settings
    SECRET_KEY: str = os.getenv("SECRET_KEY", "antigravity_super_secret_jwt_key_2026_change_me")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12  # 12 Hours

    # Default Users
    ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "admin").strip()
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "admin123").strip()
    USER_USERNAME: str = os.getenv("USER_USERNAME", "user").strip()
    USER_PASSWORD: str = os.getenv("USER_PASSWORD", "user123").strip()

    # SQLite Settings
    SQLITE_DB_PATH: str = os.getenv("SQLITE_DB_PATH", "./data.db").strip()

settings = Settings()
