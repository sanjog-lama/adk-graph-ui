import logging
from logging.handlers import RotatingFileHandler
import os

def setup_logger(name=None):
    """Setup logging configuration for entire application."""
    
    # Get the root logger if no name is specified
    if name:
        logger = logging.getLogger(name)
    else:
        logger = logging.getLogger()
    
    logger.setLevel(logging.INFO)
    
    # Clear any existing handlers to avoid duplicates
    if logger.handlers:
        logger.handlers.clear()
    
    # Create logs directory if it doesn't exist
    if not os.path.exists('logs'):
        os.makedirs('logs')
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    
    # File handler
    file_handler = RotatingFileHandler(
        'logs/adk_chat_ui.log',
        maxBytes=10485760,
        backupCount=5
    )
    file_handler.setLevel(logging.INFO)
    
    # Formatter
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    console_handler.setFormatter(formatter)
    file_handler.setFormatter(formatter)
    
    # Add handlers
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)
    
    return logger