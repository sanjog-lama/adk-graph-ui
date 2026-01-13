import requests
import re
import json
from typing import Optional, Tuple, Generator
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class ADKService:
    def __init__(self, api_base: str):
        self.api_base = api_base
    
    def list_agents(self) -> list:
        try:
            response = requests.get(f'{self.api_base}/list-apps', timeout=5)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            logger.error(f"Failed to fetch agents: {e}")
            return []
    
    def create_session(self, agent: str, user_id: str, session_id: str) -> bool:
        try:
            response = requests.post(
                f'{self.api_base}/apps/{agent}/users/{user_id}/sessions/{session_id}',
                json={},
                timeout=5
            )
            response.raise_for_status()
            return True
        except requests.RequestException as e:
            logger.error(f"Failed to create session: {e}")
            return False
    
    def delete_session(self, agent: str, user_id: str, session_id: str):
        try:
            response = requests.delete(
                f'{self.api_base}/apps/{agent}/users/{user_id}/sessions/{session_id}',
                timeout=5
            )
            # Don't raise error for delete - it might fail if session doesn't exist
            return response.ok
        except requests.RequestException as e:
            logger.error(f"Failed to delete session: {e}")
            return False
        
    def get_sessions(self, agent: str, user_id: str) -> dict:
        """Fetch all sessions metadata for a user from ADK."""
        url = f'{self.api_base}/apps/{agent}/users/{user_id}/sessions'
        try:
            logger.info(f"Fetching sessions from ADK backend: {url}")
            response = requests.get(url, timeout=5)
            logger.info(f"Received HTTP {response.status_code} from ADK backend")

            response.raise_for_status()

            sessions_list = response.json()
            # logger.info(f"Raw sessions response: {sessions_list}")

            # Convert list to dict with metadata only
            sessions = {}
            for s in sessions_list:
                session_id = s.get('id')
                
                sessions[session_id] = {
                    'sessionId': session_id,  # Keep consistent naming
                    'created': s.get('lastUpdateTime'),
                    'appName': s.get('appName'),
                    'userId': s.get('userId'),
                    'hasState': bool(s.get('state')),
                    'hasEvents': len(s.get('events', [])) > 0,
                    'lastUpdateTime': s.get('lastUpdateTime')
                }

            logger.info(f"Processed {len(sessions)} sessions (metadata only)")
            return sessions

        except requests.RequestException as e:
            logger.error(f"Failed to fetch sessions from {url}: {e}")
            return {}
        except Exception as e:
            logger.error(f"Error processing sessions: {e}")
            return {}

    def get_single_session(self, agent: str, user_id: str, session_id: str) -> dict:
        """Fetch a single session with all messages, merging analytics output if present."""
        try:
            response = requests.get(
                f'{self.api_base}/apps/{agent}/users/{user_id}/sessions/{session_id}',
                timeout=5
            )
            response.raise_for_status()
            session_data = response.json()

            # logger.info(f"Raw sessions response: {session_data}")

            # Extract messages from session events
            messages = self._extract_messages_from_session(session_data)

            # Merge analytics output into last assistant message if exists
            analytics_output = session_data.get("state", {}).get("analytics_output")
            if analytics_output and messages:
                # find last assistant message
                for msg in reversed(messages):
                    if msg["role"] == "assistant":
                        msg["content"] += f"\n\n{analytics_output}"
                        break

            return {
                "sessionId": session_id,
                "messages": messages,
                "metadata": {
                    "appName": session_data.get("appName"),
                    "userId": session_data.get("userId"),
                    "created": session_data.get("lastUpdateTime"),
                    "state": session_data.get("state", {}),
                    "events": session_data.get("events", [])
                }
            }

        except requests.RequestException as e:
            logger.error(f"Failed to fetch session {session_id}: {e}")
            return {"sessionId": session_id, "messages": [], "error": str(e)}
        except Exception as e:
            logger.error(f"Error processing session {session_id}: {e}")
            return {"sessionId": session_id, "messages": [], "error": str(e)}


    def _extract_messages_from_session(self, session_data: dict) -> list:
        """Extract messages from session events into standardized format."""
        messages = []
        events = session_data.get("events", [])

        for event in events:
            content = event.get("content", {})
            parts = content.get("parts", [])
            if not parts:
                continue

            text_parts = []
            for part in parts:
                if "text" in part:
                    text_parts.append(part["text"])
            if not text_parts:
                continue

            # Treat any non-user author as assistant
            role = "user" if event.get("author") == "user" else "assistant"

            messages.append({
                "role": role,
                "content": "\n".join(text_parts),
                "timestamp": datetime.fromtimestamp(
                    event.get("timestamp", 0)
                ).isoformat()
            })

        return messages

    def send_message_stream(self, agent: str, user_id: str, session_id: str, 
                           message: str) -> Generator[dict, None, None]:
        """
        Stream SSE events from ADK /run_sse endpoint.
        Yields each event as a dictionary.
        """
        payload = {
            'appName': agent,
            'userId': user_id,
            'sessionId': session_id,
            'newMessage': {
                'role': 'user',
                'parts': [{'text': message}]
            },
            'streaming': True  # Enable token-level streaming
        }
        
        try:
            logger.info(f"[SSE] Starting stream for session {session_id}")
            
            response = requests.post(
                f'{self.api_base}/run_sse',
                json=payload,
                stream=True,  # CRITICAL: Enable streaming
                timeout=600,
                headers={'Accept': 'text/event-stream'}
            )
            response.raise_for_status()
            
            # Process SSE stream line by line
            for line in response.iter_lines(decode_unicode=True):
                if line:
                    line = line.strip()
                    if line.startswith('data: '):
                        event_data = line[6:]  # Remove 'data: ' prefix
                        
                        if not event_data.strip():
                            continue
                        
                        try:
                            event = json.loads(event_data)
                            yield event
                        except json.JSONDecodeError as e:
                            logger.error(f"[SSE] Failed to parse event: {e}")
                            continue
            
            logger.info(f"[SSE] Stream completed for session {session_id}")
            
        except requests.Timeout:
            logger.error("[SSE] Stream timed out")
            yield {'error': 'timeout', 'message': 'Request timed out'}
        except requests.RequestException as e:
            logger.error(f"[SSE] Stream error: {e}")
            yield {'error': 'request_failed', 'message': str(e)}
        except Exception as e:
            logger.error(f"[SSE] Unexpected error: {e}")
            yield {'error': 'unknown', 'message': str(e)}
    
    def send_message(self, agent: str, user_id: str, session_id: str, 
                    message: str) -> Tuple[Optional[str], Optional[dict]]:
        payload = {
            'appName': agent,
            'userId': user_id,
            'sessionId': session_id,
            'newMessage': {
                'role': 'user',
                'parts': [{'text': message}]
            }
        }
        
        try:
            response = requests.post(
                f'{self.api_base}/run',
                json=payload,
                timeout=600
            )
            response.raise_for_status()
            
            response_data = response.json()
            assistant_response = self._extract_assistant_response(response_data)
            
            return assistant_response, response_data
            
        except requests.Timeout:
            logger.error("Request timed out")
            return None, None
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            return None, None
    
    def _extract_assistant_response(self, response_data: list) -> str:
        """Extract text from assistant response."""
        assistant_response = ""
        
        if not isinstance(response_data, list):
            return assistant_response
            
        for event in response_data:
            if isinstance(event, dict):
                content = event.get('content', {})
                if isinstance(content, dict):
                    parts = content.get('parts', [])
                    if isinstance(parts, list):
                        for part in parts:
                            if isinstance(part, dict):
                                text = part.get('text')
                                if text:
                                    assistant_response += str(text)
        
        return assistant_response
    
    def extract_analytics_data(self, response_data: list) -> Optional[dict]:
        """Extract and parse analytics data from response."""
        for event in response_data:
            if isinstance(event, dict):
                actions = event.get('actions', {})
                if isinstance(actions, dict):
                    state_delta = actions.get('stateDelta')
                    if isinstance(state_delta, dict) and state_delta.get('analytics_output'):
                        analytics_output = state_delta['analytics_output']
                        
                        # Try to parse as JSON from markdown code block
                        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', str(analytics_output))
                        if json_match:
                            try:
                                return json.loads(json_match.group(1))
                            except json.JSONDecodeError:
                                # Try to fix common JSON issues
                                fixed_json = self._fix_json(json_match.group(1))
                                try:
                                    return json.loads(fixed_json)
                                except json.JSONDecodeError:
                                    logger.error("Failed to parse JSON after fixing")
                        # Check if already a dict
                        elif isinstance(analytics_output, dict):
                            return analytics_output
                        # Try parsing as raw JSON string
                        else:
                            try:
                                return json.loads(str(analytics_output))
                            except json.JSONDecodeError:
                                logger.error("Failed to parse raw analytics output")
        
        return None
    
    def _fix_json(self, json_str: str) -> str:
        """Fix common JSON issues."""
        # Remove trailing commas before } or ]
        fixed = re.sub(r',(\s*[}\]])', r'\1', json_str)
        # Normalize whitespace
        fixed = ' '.join(fixed.split())
        return fixed