from flask import Blueprint, render_template

def create_view_blueprint():
    """Factory function to create view blueprint"""
    view_bp = Blueprint('view', __name__)
    
    @view_bp.route('/')
    def index():
        return render_template('index.html')
    
    return view_bp

# Alias for backward compatibility
view_bp = create_view_blueprint