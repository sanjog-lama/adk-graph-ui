import os
from dataclasses import dataclass

@dataclass
class Config:
    ADK_API_BASE: str = os.environ.get('ADK_API_BASE', 'http://localhost:8000')
    HOST: str = os.environ.get('ADK_CHAT_UI_HOST', '0.0.0.0')
    PORT: int = int(os.environ.get('ADK_CHAT_UI_PORT', 5000))
    SECRET_KEY: str = os.environ.get('SECRET_KEY', 'sanjog')
    DEBUG: bool = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'