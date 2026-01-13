from flask import Blueprint, request, jsonify, Response
import json
import traceback
from utils.logger import setup_logger

# Initialize logger
logger = setup_logger(__name__)

def create_api_blueprint(adk_service, session_service):
    """Factory function to create API blueprint with service instances"""
    api_bp = Blueprint('api', __name__, url_prefix='/api')
    
    @api_bp.route('/list-agents')
    def list_agents():
        agents = adk_service.list_agents()
        return jsonify(agents)
    
    @api_bp.route('/sessions')
    def get_sessions():
        agent = request.args.get('agent')
        user_id = request.args.get('user')
        
        try:
            # Fetch sessions from ADK backend
            sessions = adk_service.get_sessions(agent, user_id)
             # ---- SAFE LOGGING (summary only) ----
            if isinstance(sessions, dict):
                logger.info(
                    f"Sessions fetched successfully | count={len(sessions)} | "
                    f"session_ids={list(sessions.keys())}"
                )
            else:
                logger.warning(
                    f"Unexpected sessions type: {type(sessions)} | value={sessions}"
                )
            return jsonify(sessions)
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)}), 500
        
    @api_bp.route('/session/<session_id>')
    def get_session(session_id):
        agent = request.args.get('agent')
        user_id = request.args.get('user')
        
        try:
            session_data = adk_service.get_single_session(agent, user_id, session_id)
            return jsonify(session_data)
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)}), 500
    
    @api_bp.route('/create-session', methods=['POST'])
    def create_session():
        try:
            data = request.json
            agent = data['agent']
            user_id = data['userId']
            session_id = data['sessionId']
            
            success = adk_service.create_session(agent, user_id, session_id)
            if success:
                session_service.create_session(agent, user_id, session_id)
                return jsonify({'status': 'success', 'sessionId': session_id})
            else:
                return jsonify({'status': 'error', 'message': 'Failed to create session'}), 500
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)}), 500
    
    @api_bp.route('/delete-session', methods=['DELETE'])
    def delete_session():
        try:
            data = request.json
            agent = data['agent']
            user_id = data['userId']
            session_id = data['sessionId']
            
            adk_service.delete_session(agent, user_id, session_id)
            session_service.delete_session(agent, user_id, session_id)
            
            return jsonify({'status': 'success'})
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)}), 500
    
    @api_bp.route('/send-message', methods=['POST'])
    def send_message():
        try:
            data = request.json
            agent = data['agent']
            user_id = data['userId']
            session_id = data['sessionId']
            message = data['message']
            
            print(f"[BACKEND] Sending message to agent '{agent}', session '{session_id}'")
            
            # Add user message to session
            session_service.add_message(agent, user_id, session_id, 'user', message)
            
            # Send to ADK
            assistant_response, full_response = adk_service.send_message(
                agent, user_id, session_id, message
            )
            
            if assistant_response is not None:
                # Add assistant response to session
                session_service.add_message(
                    agent, user_id, session_id,
                    'assistant', assistant_response, full_response
                )
                
                return jsonify({
                    'status': 'success',
                    'response': assistant_response,
                    'full_response': full_response
                })
            else:
                return jsonify({'status': 'error', 'message': 'Failed to get response'}), 500
                
        except Exception as e:
            print(f"[BACKEND] Error in send_message: {e}")
            print(traceback.format_exc())
            return jsonify({'status': 'error', 'message': str(e)}), 500
    
    @api_bp.route('/send-message-sse', methods=['POST'])
    def send_message_sse():
        """SSE endpoint that streams events from ADK to frontend."""
        try:
            data = request.json
            agent = data['agent']
            user_id = data['userId']
            session_id = data['sessionId']
            message = data['message']
            
            logger.info(f"[SSE] Starting stream - agent: {agent}, session: {session_id}")
            
            # Add user message immediately
            session_service.add_message(agent, user_id, session_id, 'user', message)
            
            def generate():
                full_response = []
                assistant_text = ""
                
                try:
                    # Stream events from ADK
                    for event in adk_service.send_message_stream(agent, user_id, session_id, message):
                        # Handle errors
                        if 'error' in event:
                            error_event = {
                                'type': 'error',
                                'error': event.get('error'),
                                'message': event.get('message', 'Unknown error')
                            }
                            yield f"data: {json.dumps(error_event)}\n\n"
                            break
                        
                        # Store full response
                        full_response.append(event)
                        
                        # Extract text content
                        content = event.get('content', {})
                        if isinstance(content, dict):
                            parts = content.get('parts', [])
                            if isinstance(parts, list):
                                for part in parts:
                                    if isinstance(part, dict) and 'text' in part:
                                        assistant_text += part['text']
                        
                        # Forward event to frontend
                        yield f"data: {json.dumps(event)}\n\n"
                    
                    # Save assistant message after stream completes
                    if assistant_text:
                        session_service.add_message(
                            agent, user_id, session_id,
                            'assistant', assistant_text, full_response
                        )
                        logger.info(f"[SSE] Saved assistant message to session {session_id}")
                    
                    # Send completion event
                    yield f"data: {json.dumps({'type': 'complete'})}\n\n"
                    
                except Exception as e:
                    logger.error(f"[SSE] Stream error: {e}")
                    logger.error(traceback.format_exc())
                    error_event = {'type': 'error', 'message': str(e)}
                    yield f"data: {json.dumps(error_event)}\n\n"
            
            return Response(
                generate(),
                mimetype='text/event-stream',
                headers={
                    'Cache-Control': 'no-cache',
                    'X-Accel-Buffering': 'no',
                    'Connection': 'keep-alive'
                }
            )
                
        except Exception as e:
            logger.error(f"[SSE] Error: {e}")
            logger.error(traceback.format_exc())
            return jsonify({'status': 'error', 'message': str(e)}), 500

    return api_bp


# Alias for backward compatibility
api_bp = create_api_blueprint