from flask import Flask
from config import Config
from routes.api_routes import api_bp
from routes.view_routes import view_bp
from services.session_service import SessionService
from services.adk_service import ADKService
from utils.logger import setup_logger

# Initialize logger
logger = setup_logger(__name__)

# Create Flask app
app = Flask(__name__)
app.config.from_object(Config())

# Initialize services
adk_service = ADKService(app.config['ADK_API_BASE'])
session_service = SessionService()

# Register blueprints with service instances
app.register_blueprint(api_bp(adk_service, session_service))
app.register_blueprint(view_bp())

if __name__ == '__main__':
    logger.info("="*60)
    logger.info("ADK Chat UI Server - Organized Edition")
    logger.info(f"ADK API Base: {app.config['ADK_API_BASE']}")
    logger.info(f"Starting server on http://{app.config['HOST']}:{app.config['PORT']}")
    logger.info("="*60)
    
    app.run(
        debug=app.config['DEBUG'],
        host=app.config['HOST'],
        port=app.config['PORT']
    )